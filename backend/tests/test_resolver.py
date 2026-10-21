import asyncio
import os
import shutil

import httpx
import pytest

from app import resolver as r
from main import create_app

REAL_ENSURE_PUBLIC = r.ensure_public  # the autouse fixture below replaces it for the other tests


# ---- address checks (SSRF) ------------------------------------------------------------------------------------------

@pytest.mark.parametrize("url", [
    "ftp://example.com/x", "file:///etc/passwd", "javascript:alert(1)", "//example.com/x", "https://", "not a url",
    "https://user:pw@example.com/x", "https://exa mple.com", "https://example.com:8080/x", "https://example.com:22/",
    "x" * 3000,
])
def test_bad_urls_rejected(url):
    with pytest.raises(r.ResolveError) as e:
        r.validate_page_url(url)
    assert e.value.code in {"bad_url", "blocked_host"}


@pytest.mark.parametrize("url", [
    "http://localhost/x", "http://127.0.0.1/x", "http://[::1]/x", "http://10.0.0.5/x", "http://192.168.1.1/x",
    "http://172.16.0.9/x", "http://169.254.169.254/latest/meta-data", "http://0.0.0.0/", "http://printer.local/",
    "http://db.internal/", "http://service.localhost/", "http://100.64.0.1/", "http://[fd00::1]/",
])
def test_private_hosts_rejected(url):
    with pytest.raises(r.ResolveError) as e:
        r.validate_page_url(url)
    assert e.value.code == "blocked_host"


def test_public_urls_pass_and_allowlist_applies():
    assert r.validate_page_url("https://streamable.com/moo")[1] == "streamable.com"
    assert r.validate_page_url("https://www.example.com:443/a?b=c")[1] == "www.example.com"
    assert r.validate_page_url("https://cdn.example.com/x", ("example.com",))[1] == "cdn.example.com"
    with pytest.raises(r.ResolveError):
        r.validate_page_url("https://evil.test/x", ("example.com",))
    with pytest.raises(r.ResolveError):
        r.validate_page_url("https://notexample.com/x", ("example.com",))  # a suffix match must be on a dot boundary


async def test_dns_names_pointing_inside_are_rejected(monkeypatch):
    def fake(host, port, *a, **kw):
        return [(2, 1, 6, "", ("93.184.216.34", 0)), (2, 1, 6, "", ("10.1.2.3", 0))]  # one public, one private

    monkeypatch.setattr("socket.getaddrinfo", fake)
    with pytest.raises(r.ResolveError) as e:
        await REAL_ENSURE_PUBLIC("rebind.example")
    assert e.value.code == "blocked_host"
    monkeypatch.setattr("socket.getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 0))])
    await REAL_ENSURE_PUBLIC("fine.example")


# ---- choosing one playable address ----------------------------------------------------------------------------------

def fmt(**kw):
    base = {"url": "https://cdn.test/v.mp4", "protocol": "https", "ext": "mp4", "vcodec": "avc1", "acodec": "mp4a", "height": 720, "http_headers": {"User-Agent": "x", "Accept": "*/*"}}
    base.update(kw)
    return base


def test_streamable_style_single_url():
    got = r.pick_format({"title": "me irl", "duration": 12, "url": "https://cdn.test/a.mp4"})
    assert got and got.url == "https://cdn.test/a.mp4" and got.protocol == "https" and got.duration == 12


def test_prefers_highest_within_cap_and_files_over_hls():
    info = {"formats": [
        fmt(url="https://a/360.mp4", height=360),
        fmt(url="https://a/1080.mp4", height=1080),
        fmt(url="https://a/1080.m3u8", height=1080, protocol="m3u8_native", ext="mp4"),
        fmt(url="https://a/2160.mp4", height=2160),
    ]}
    assert r.pick_format(info).url == "https://a/1080.mp4"


def test_hls_when_there_is_no_file():
    got = r.pick_format({"formats": [fmt(url="https://a/m.m3u8", protocol="m3u8_native", height=1080), fmt(url="https://a/s.m3u8", protocol="m3u8_native", height=288)]})
    assert got.protocol == "hls" and got.height == 1080


def vfmt(h, vcodec="avc1.640028", url=None, **kw):
    return fmt(url=url or f"https://a/v{h}.mp4", height=h, vcodec=vcodec, acodec="none", **kw)


def afmt(url="https://a/a.m4a", **kw):
    base = {"url": url, "protocol": "https", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2", "abr": 128, "format_id": "140", "http_headers": {"User-Agent": "x"}}
    base.update(kw)
    return base


def test_split_streams_are_paired_when_nothing_else_exists():
    got = r.pick_format({"title": "t", "formats": [vfmt(360), vfmt(1080), vfmt(2160), afmt(url="https://a/low.m4a", abr=48), afmt(url="https://a/hi.m4a", abr=128)]})
    assert got.url == "https://a/v1080.mp4" and got.audio_url == "https://a/hi.m4a" and got.height == 1080 and got.fallback_url is None


def test_pair_beats_a_much_smaller_single_file_and_keeps_it_as_fallback():
    got = r.pick_format({"formats": [fmt(url="https://a/small.mp4", height=360), vfmt(1080), afmt()]})
    assert got.audio_url and got.height == 1080 and got.fallback_url == "https://a/small.mp4"


def test_single_file_wins_when_the_pair_is_only_slightly_better():
    got = r.pick_format({"formats": [fmt(url="https://a/800.mp4", height=800), vfmt(1080), afmt()]})
    assert got.audio_url is None and got.url == "https://a/800.mp4"


def test_pair_prefers_widely_playable_codec_and_plain_audio():
    got = r.pick_format({"formats": [
        vfmt(1080, vcodec="av01.0.08M.08", url="https://a/av1.mp4"), vfmt(1080, vcodec="vp9", url="https://a/vp9.mp4", ext="webm"), vfmt(1080, url="https://a/h264.mp4"),
        afmt(url="https://a/drc.m4a", format_id="140-drc", abr=200), afmt(url="https://a/plain.m4a", abr=128),
    ]})
    assert got.url == "https://a/h264.mp4" and got.audio_url == "https://a/plain.m4a"


def test_video_only_without_any_audio_is_unusable():
    assert r.pick_format({"formats": [vfmt(1080)]}) is None
    assert r.pick_format({"formats": [afmt()]}) is None


def test_pair_ignores_segment_lists_and_other_schemes():
    assert r.pick_format({"formats": [vfmt(1080, protocol="http_dash_segments"), afmt(), vfmt(720, url="javascript:1")]}) is None


def test_unsafe_schemes_and_dash_ignored():
    assert r.pick_format({"formats": [fmt(url="javascript:1"), fmt(protocol="http_dash_segments"), fmt(url="ftp://a/b.mp4")]}) is None


def test_unknown_codecs_count_as_combined():
    assert r.pick_format({"formats": [fmt(vcodec="", acodec="", height=480)]}).height == 480


def test_headers_flag():
    assert r.pick_format({"formats": [fmt(http_headers={"User-Agent": "x", "Referer": "https://site/"})]}).needs_headers is True
    assert r.pick_format({"formats": [fmt(http_headers={"User-Agent": "x", "Sec-Fetch-Mode": "navigate"})]}).needs_headers is False


@pytest.mark.parametrize("stderr,code", [
    ("ERROR: Unsupported URL: https://x", "unsupported"),
    ("ERROR: [vimeo] 1: The web client only works when logged-in", "login"),
    ("ERROR: Video unavailable", "unavailable"),
    ("ERROR: HTTP Error 403: Forbidden", "refused"),
    ("something odd", "failed"),
])
def test_error_classification(stderr, code):
    assert r._classify(stderr) == code


# ---- the Resolver ---------------------------------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def public_dns(monkeypatch):
    async def ok(host):
        return None

    monkeypatch.setattr(r, "ensure_public", ok)


def make(runner, **kw):
    args = dict(hosts=(), timeout=5, concurrent=1, proxy="", cache_ttl=60, runner=runner)
    args.update(kw)
    return r.Resolver(**args)


async def test_resolver_caches_and_limits_waiting():
    calls = []

    async def runner(url, timeout, proxy):
        calls.append(url)
        await asyncio.sleep(0.05)
        return {"title": "t", "url": "https://cdn.test/a.mp4"}

    res = make(runner)
    a = await res.resolve("https://site.test/v/1")
    b = await res.resolve("https://site.test/v/1")
    assert a is b and calls == ["https://site.test/v/1"]

    slow = make(runner, concurrent=1)  # 1 running + 3 waiting is the most it accepts
    results = await asyncio.gather(*[slow.resolve(f"https://site.test/v/{i}") for i in range(8)], return_exceptions=True)
    busy = [x for x in results if isinstance(x, r.ResolveError) and x.code == "busy"]
    assert len(busy) == 4 and sum(isinstance(x, r.Resolved) for x in results) == 4


async def test_unplayable_result_is_an_error():
    async def runner(url, timeout, proxy):
        return {"formats": [vfmt(1080)]}

    with pytest.raises(r.ResolveError) as e:
        await make(runner).resolve("https://site.test/v")
    assert e.value.code == "no_single_stream"


async def test_tool_gets_an_empty_environment_and_a_timeout(monkeypatch, tmp_path):
    script = tmp_path / "fake-ytdlp"
    script.write_text("#!/bin/sh\nenv | grep -c SECRET_TOKEN >&2; sleep 5\n")
    script.chmod(0o755)
    monkeypatch.setenv("SECRET_TOKEN", "hunter2")
    with pytest.raises(r.ResolveError) as e:
        await r.run_ytdlp("https://site.test/v", 0.5, binary=[str(script)])
    assert e.value.code == "timeout"
    ok = tmp_path / "ok-ytdlp"
    ok.write_text('#!/bin/sh\nif env | grep -q SECRET_TOKEN; then echo leaked >&2; exit 1; fi\necho \'{"title":"t","url":"https://cdn.test/a.mp4"}\'\n')
    ok.chmod(0o755)
    assert (await r.run_ytdlp("https://site.test/v", 5, binary=[str(ok)]))["title"] == "t"


async def test_tool_missing_is_reported(monkeypatch):
    monkeypatch.setattr(r, "find_binary", lambda: None)
    with pytest.raises(r.ResolveError) as e:
        await r.run_ytdlp("https://site.test/v", 5)
    assert e.value.code == "unavailable_tool"


# ---- HTTP -----------------------------------------------------------------------------------------------------------

async def client_for(monkeypatch, tool=True, **env):
    monkeypatch.setattr(r, "find_binary", lambda: ["yt-dlp"] if tool else None)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    app = create_app()
    return app, httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


async def test_switched_off_by_default(monkeypatch):
    app, c = await client_for(monkeypatch)
    async with c:
        assert (await c.get("/api/config")).json() == {"resolver": False}
        assert (await c.post("/api/resolve", json={"url": "https://site.test/v"})).status_code == 404


async def test_endpoint_end_to_end_with_limits(monkeypatch):
    app, c = await client_for(monkeypatch, RESOLVER_ENABLED="true", RESOLVER_PER_MINUTE="3")

    async def runner(url, timeout, proxy):
        if "bad" in url:
            raise r.ResolveError("unsupported")
        return {"title": "Hello", "duration": 9, "url": "https://cdn.test/a.mp4"}

    app.state.resolver.runner = runner
    async with c:
        assert (await c.get("/api/config")).json() == {"resolver": True}
        ok = await c.post("/api/resolve", json={"url": "https://site.test/v"})
        assert ok.status_code == 200 and ok.json() == {"title": "Hello", "url": "https://cdn.test/a.mp4", "protocol": "https", "height": None, "duration": 9.0, "needsHeaders": False, "audioUrl": None, "fallbackUrl": None}
        assert (await c.post("/api/resolve", json={"url": "https://site.test/bad"})).json() == {"detail": "unsupported"}
        assert (await c.post("/api/resolve", json={"url": "http://169.254.169.254/"})).status_code == 422
        assert (await c.post("/api/resolve", json={"url": "https://site.test/v", "x": 1})).status_code == 422
        assert (await c.post("/api/resolve", json={"url": "https://site.test/v"})).status_code == 429


# ---- the real tool (needs yt-dlp and the internet): RUN_NETWORK_TESTS=1 ---------------------------------------------

@pytest.mark.skipif(not os.getenv("RUN_NETWORK_TESTS") or not shutil.which("yt-dlp"), reason="needs yt-dlp and the internet")
async def test_real_streamable_and_dailymotion():
    res = r.Resolver(hosts=(), timeout=40, concurrent=1, proxy="", cache_ttl=1)
    got = await res.resolve("https://streamable.com/moo")
    assert got.protocol == "https" and ".mp4" in got.url
    got = await res.resolve("https://www.dailymotion.com/video/x8wbmts")
    assert got.protocol == "hls" and got.height and got.height >= 720


async def test_enabled_but_tool_missing_stays_off_and_says_so(monkeypatch, caplog):
    import logging

    with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
        app, c = await client_for(monkeypatch, tool=False, RESOLVER_ENABLED="true")
    async with c:
        assert (await c.get("/api/config")).json() == {"resolver": False}
        assert (await c.post("/api/resolve", json={"url": "https://site.test/v"})).status_code == 404
    assert "yt-dlp was not found" in caplog.text and "--build" in caplog.text
