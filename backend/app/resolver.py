"""
Optional "page link -> direct video link" lookup with yt-dlp. OFF unless RESOLVER_ENABLED=true.

It only *looks up* a link; the video itself never goes through this server. A resolved link works only when the
host does not tie it to this server's address or to the original site, which many do (see the README).
Because the server fetches an address chosen by a visitor, every address is checked first (SSRF), the process
gets an empty environment, runs under a timeout, and only a few run at a time.
"""

import asyncio
import ipaddress
import json
import shutil
import socket
import sys
import time
from dataclasses import asdict, dataclass
from typing import Any
from urllib.parse import urlsplit

MAX_PAGE_URL = 2048
MAX_OUTPUT = 8 * 1024 * 1024
PORTS = {None, 80, 443}
MAX_HEIGHT = 1080
# Headers every extractor sets; anything else (Referer, Cookie, Origin ...) is something a browser cannot send.
HARMLESS_HEADERS = {"user-agent", "accept", "accept-language", "accept-encoding", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-site", "sec-fetch-user", "connection"}


class ResolveError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass
class Resolved:
    title: str
    url: str
    protocol: str  # "https" (a file) or "hls"
    height: int | None
    duration: float | None
    needs_headers: bool
    audio_url: str | None = None  # set when picture and sound are separate files: the page plays both and keeps them together
    fallback_url: str | None = None  # a single file to fall back to when the pair does not play

    def public(self) -> dict[str, Any]:
        d = asdict(self)
        d["needsHeaders"] = d.pop("needs_headers")
        d["audioUrl"] = d.pop("audio_url")
        d["fallbackUrl"] = d.pop("fallback_url")
        return d


def validate_page_url(raw: str, allowed_hosts: tuple[str, ...] = ()) -> tuple[str, str]:
    """Return (url, host) or raise ResolveError. Cheap checks only; DNS comes next."""
    if not isinstance(raw, str) or not raw or len(raw) > MAX_PAGE_URL or any(ch.isspace() or ord(ch) < 32 for ch in raw):
        raise ResolveError("bad_url")
    parts = urlsplit(raw)
    if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username or parts.password:
        raise ResolveError("bad_url")
    try:
        port = parts.port
    except ValueError as err:
        raise ResolveError("bad_url") from err
    if port not in PORTS:
        raise ResolveError("blocked_host")
    host = parts.hostname.lower().rstrip(".")
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".lan", ".home", ".corp")):
        raise ResolveError("blocked_host")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None and not literal.is_global:
        raise ResolveError("blocked_host")
    if allowed_hosts and not any(host == h or host.endswith("." + h) for h in allowed_hosts):
        raise ResolveError("blocked_host")
    return raw, host


async def ensure_public(host: str) -> None:
    """Every address the name points to must be a public one."""
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except OSError as err:
        raise ResolveError("bad_url") from err
    if not infos:
        raise ResolveError("bad_url")
    for info in infos:
        if not ipaddress.ip_address(info[4][0]).is_global:
            raise ResolveError("blocked_host")


def _harmful_headers(headers: dict[str, Any] | None) -> bool:
    return any(k.lower() not in HARMLESS_HEADERS for k in (headers or {}))


CODEC_RANK = {"avc1": 3, "vp9": 2, "vp09": 2, "av01": 1}  # what browsers play most widely first
PAIR_GAIN = 1.4  # a split pair must be this much taller than a single file to be worth the extra moving parts


def _http(f: dict[str, Any]) -> bool:
    return isinstance(f.get("url"), str) and f["url"].startswith(("http://", "https://"))


def _single(info: dict[str, Any]) -> dict[str, Any] | None:
    """The best single address with picture and sound together: a file, or an HLS stream."""
    candidates: list[dict[str, Any]] = []
    for f in info.get("formats") or []:
        if not _http(f) or f.get("protocol") not in {"https", "http", "m3u8", "m3u8_native"}:
            continue
        if f.get("vcodec") == "none" or f.get("acodec") == "none":
            continue  # video-only or audio-only
        if f.get("ext") not in {None, "mp4", "webm", "m4v", "mov", "m3u8", "mp3"} and f.get("protocol") in {"https", "http"}:
            continue
        candidates.append(f)
    if not candidates and _http(info) and not info.get("requested_formats"):
        candidates = [info]
    if not candidates:
        return None

    def rank(f: dict[str, Any]) -> tuple[int, int, int]:
        h = f.get("height") or 0
        within = 1 if h <= MAX_HEIGHT else 0
        progressive = 1 if f.get("protocol") in {"https", "http"} else 0  # no CORS or hls.js needed
        return (within, min(h, MAX_HEIGHT) if within else -h, progressive)

    return max(candidates, key=rank)


def _pair(info: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """The best video-only file and a matching audio-only file (plain files only: no DASH or segment lists)."""
    videos, audios = [], []
    for f in info.get("formats") or []:
        if not _http(f) or f.get("protocol") not in {"https", "http"}:
            continue
        vcodec, acodec = f.get("vcodec") or "", f.get("acodec") or ""
        if vcodec not in {"", "none"} and acodec == "none" and f.get("ext") in {"mp4", "webm", "m4v"} and isinstance(f.get("height"), int):
            videos.append(f)
        elif acodec not in {"", "none"} and vcodec == "none" and f.get("ext") in {"m4a", "mp4", "webm", "mp3", "aac", "opus"}:
            audios.append(f)
    if not videos or not audios:
        return None

    def vrank(f: dict[str, Any]) -> tuple[int, int, int, float]:
        h = f["height"]
        within = 1 if h <= MAX_HEIGHT else 0
        return (within, min(h, MAX_HEIGHT) if within else -h, CODEC_RANK.get((f.get("vcodec") or "").split(".")[0], 0), float(f.get("tbr") or 0))

    def arank(f: dict[str, Any]) -> tuple[int, int, float]:
        drc = "drc" in str(f.get("format_id", "")).lower() or "drc" in str(f.get("format_note", "")).lower()  # compressed loudness: avoid
        return (0 if drc else 1, 1 if f.get("ext") == "m4a" else 0, float(f.get("abr") or f.get("tbr") or 0))

    return max(videos, key=vrank), max(audios, key=arank)


def pick_format(info: dict[str, Any]) -> Resolved | None:
    """Choose what a browser can play: one address, or (when that is clearly better) a video file plus an audio file."""
    title = str(info.get("title") or "")[:200]
    duration = float(info["duration"]) if isinstance(info.get("duration"), (int, float)) else None
    single = _single(info)
    pair = _pair(info)
    if single is None and pair is None:
        return None
    single_height = (single or {}).get("height") if isinstance((single or {}).get("height"), int) else 0
    if pair and (single is None or pair[0]["height"] >= PAIR_GAIN * max(single_height, 1)):
        video, audio = pair
        fallback = single["url"] if single else None
        return Resolved(
            title=title,
            url=video["url"],
            protocol="https",
            height=video["height"],
            duration=duration,
            needs_headers=_harmful_headers(video.get("http_headers")) or _harmful_headers(audio.get("http_headers")),
            audio_url=audio["url"],
            fallback_url=fallback,
        )
    assert single is not None
    hls = single.get("protocol") in {"m3u8", "m3u8_native"}
    return Resolved(
        title=title,
        url=single["url"],
        protocol="hls" if hls else "https",
        height=single.get("height") if isinstance(single.get("height"), int) else None,
        duration=duration,
        needs_headers=_harmful_headers(single.get("http_headers")),
    )


def _classify(stderr: str) -> str:
    text = stderr.lower()
    if "unsupported url" in text:
        return "unsupported"
    if any(k in text for k in ("sign in", "log in", "logged in", "logged-in", "login", "private video", "confirm you", "age-restricted", "cookies")):
        return "login"
    if any(k in text for k in ("unavailable", "not available", "removed", "does not exist", "404", "geo")):
        return "unavailable"
    if any(k in text for k in ("403", "429", "too many requests", "forbidden")):
        return "refused"
    return "failed"


def find_binary() -> list[str] | None:
    found = shutil.which("yt-dlp")
    if found:
        return [found]
    try:
        import yt_dlp  # noqa: F401  (only checking that it is installed)
    except ImportError:
        return None
    return [sys.executable, "-m", "yt_dlp"]


async def run_ytdlp(url: str, timeout: float, proxy: str = "", binary: list[str] | None = None) -> dict[str, Any]:
    cmd = binary or find_binary()
    if cmd is None:
        raise ResolveError("unavailable_tool")
    args = [*cmd, "--ignore-config", "-J", "--no-playlist", "--no-warnings", "--socket-timeout", "10", "--cache-dir", "/tmp/yt-dlp-cache"]
    if proxy:
        args += ["--proxy", proxy]
    args += ["--", url]
    # Nothing from our own environment (secrets!) is passed on.
    env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/tmp", "LANG": "C.UTF-8"}
    proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except TimeoutError as exc:
        proc.kill()
        await proc.wait()
        raise ResolveError("timeout") from exc
    if proc.returncode != 0:
        raise ResolveError(_classify(err.decode("utf-8", "replace")[-2000:]))
    if len(out) > MAX_OUTPUT:
        raise ResolveError("failed")
    try:
        data = json.loads(out)
    except ValueError as exc:
        raise ResolveError("failed") from exc
    if not isinstance(data, dict):
        raise ResolveError("failed")
    return data


class Resolver:
    def __init__(self, hosts: tuple[str, ...], timeout: float, concurrent: int, proxy: str, cache_ttl: float, runner=run_ytdlp):
        self.hosts = hosts
        self.timeout = timeout
        self.proxy = proxy
        self.cache_ttl = cache_ttl
        self.runner = runner
        self._slots = asyncio.Semaphore(max(1, concurrent))
        self._inflight = 0
        self._max_inflight = max(1, concurrent) * 4  # the running ones plus three times as many waiting
        self._cache: dict[str, tuple[float, Resolved]] = {}

    async def resolve(self, raw: str) -> Resolved:
        url, host = validate_page_url(raw, self.hosts)
        now = time.monotonic()
        hit = self._cache.get(url)
        if hit and now - hit[0] < self.cache_ttl:
            return hit[1]
        await ensure_public(host)
        if self._inflight >= self._max_inflight:
            raise ResolveError("busy")
        self._inflight += 1
        try:
            async with self._slots:
                info = await self.runner(url, self.timeout, self.proxy)
        finally:
            self._inflight -= 1
        picked = pick_format(info)
        if picked is None:
            raise ResolveError("no_single_stream")
        if len(self._cache) > 200:
            for key in [k for k, (at, _) in self._cache.items() if now - at >= self.cache_ttl]:
                del self._cache[key]
            if len(self._cache) > 200:
                self._cache.clear()
        self._cache[url] = (now, picked)
        return picked
