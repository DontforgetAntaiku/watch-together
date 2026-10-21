"""In-memory rooms. Nothing is stored on disk; a restart simply empties the rooms."""

import asyncio
import math
import re
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

# No 0/O/1/I/L: a code is read aloud and typed by hand.
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6
MAX_POSITION = 60 * 60 * 24  # a day, far beyond any video
MAX_URL = 4096  # signed CDN links are long
MAX_CLOCK_SKEW_MS = 3000
MAX_SDP = 30_000
MEDIA_TOLERANCE = 1.0  # seconds: two copies of one video rarely differ by more than container rounding
SOURCE_KINDS = {"link", "embed", "p2p"}
QUALITY = re.compile(r"^(auto|[1-9]\d{2,3})$")
# Platforms whose official players we embed. The id formats are strict: they end up in an iframe address.
EMBED_ID = {
    "youtube": re.compile(r"^[A-Za-z0-9_-]{11}$"),
    "vimeo": re.compile(r"^\d{1,12}$"),
    "streamable": re.compile(r"^[a-z0-9]{3,12}$"),
}
TWITCH_ID = {
    "channel": re.compile(r"^[A-Za-z0-9_]{3,25}$"),
    "video": re.compile(r"^\d{5,12}$"),
    "clip": re.compile(r"^[A-Za-z0-9_-]{8,100}$"),
}
VIMEO_HASH = re.compile(r"^[a-f0-9]{6,20}$")


class RoomError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def now_ms() -> int:
    return int(time.time() * 1000)


def normalize_code(raw: str) -> str:
    return raw.strip().upper()


def valid_code(raw: str) -> bool:
    return len(raw) == CODE_LENGTH and all(c in CODE_ALPHABET for c in raw)


@dataclass
class Member:
    id: str
    token: str
    queue: asyncio.Queue[dict[str, Any]] = field(default_factory=lambda: asyncio.Queue(maxsize=64))
    dur: float | None = None  # length of the video this member has loaded themselves (link or file)
    tokens: float = 0.0
    refilled: float = field(default_factory=time.monotonic)


@dataclass
class Room:
    code: str
    members: dict[str, Member] = field(default_factory=dict)
    playing: bool = False
    pos: float = 0.0
    at: int = field(default_factory=now_ms)  # server epoch ms at which `pos` was valid
    rev: int = 0
    by: str = ""
    source: dict[str, Any] | None = None  # what the room offers to watch (a link, an embed or a P2P share)
    empty_since: float | None = field(default_factory=time.monotonic)

    def media(self) -> dict[str, float | int] | None:
        """Set when people who opened their own copy report clearly different lengths (probably different cuts)."""
        durs = [m.dur for m in self.members.values() if m.dur is not None]
        if len(durs) < 2 or max(durs) - min(durs) <= MEDIA_TOLERANCE:
            return None
        return {"lo": min(durs), "hi": max(durs), "n": len(durs)}

    def snapshot(self) -> dict[str, Any]:
        return {
            "t": "state",
            "playing": self.playing,
            "pos": self.pos,
            "at": self.at,
            "rev": self.rev,
            "by": self.by,
            "n": len(self.members),
            "source": self.source,
            "media": self.media(),
        }


def _num(value: Any, lo: float, hi: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RoomError("bad_value")
    value = float(value)
    if not math.isfinite(value) or value < lo or value > hi:
        raise RoomError("bad_value")
    return value


def _clean_url(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str) or len(value) > MAX_URL:
        raise RoomError("bad_value")
    if not value.startswith(("http://", "https://")) or any(ch.isspace() or ord(ch) < 32 for ch in value):
        raise RoomError("bad_value")
    return value


def _clean_source(msg: dict[str, Any], by: str) -> dict[str, Any] | None:
    kind = msg.get("kind")
    if kind is None:
        return None
    if kind not in SOURCE_KINDS:
        raise RoomError("bad_value")
    if kind == "link":
        url = _clean_url(msg.get("url"))
        if url is None:
            raise RoomError("bad_value")
        out: dict[str, Any] = {"kind": kind, "url": url, "by": by}
        audio = msg.get("audio")
        if audio is not None and audio != "":
            out["audio"] = _clean_url(audio)  # a separate sound file for a picture-only video
        return out
    if kind == "embed":
        provider, vid = msg.get("provider"), msg.get("id")
        if not isinstance(vid, str):
            raise RoomError("bad_value")
        if provider == "twitch":
            kind_of = msg.get("type")
            if kind_of not in TWITCH_ID or not TWITCH_ID[kind_of].match(vid):
                raise RoomError("bad_value")
            return {"kind": kind, "provider": provider, "type": kind_of, "id": vid, "by": by}
        if provider not in EMBED_ID or not EMBED_ID[provider].match(vid):
            raise RoomError("bad_value")
        out: dict[str, Any] = {"kind": kind, "provider": provider, "id": vid, "by": by}
        if provider == "vimeo":
            key = msg.get("hash")
            if key is not None and (not isinstance(key, str) or not VIMEO_HASH.match(key)):
                raise RoomError("bad_value")
            out["hash"] = key
        return out
    name = msg.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 120 or any(ord(ch) < 32 for ch in name):
        raise RoomError("bad_value")
    live = msg.get("live") is True
    dur = None if live or msg.get("dur") is None else _num(msg.get("dur"), 0, MAX_POSITION)
    return {"kind": kind, "name": name.strip(), "dur": dur, "live": live, "by": by}


class RoomManager:
    def __init__(self, max_rooms: int, max_members: int, empty_ttl: float, msg_per_second: float, msg_burst: int):
        self.rooms: dict[str, Room] = {}
        self.max_rooms = max_rooms
        self.max_members = max_members
        self.empty_ttl = empty_ttl
        self.msg_per_second = msg_per_second
        self.msg_burst = msg_burst

    # -- lifecycle ---------------------------------------------------------
    def create(self) -> Room:
        self.sweep()
        if len(self.rooms) >= self.max_rooms:
            raise RoomError("busy")
        for _ in range(20):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            if code not in self.rooms:
                room = Room(code=code)
                self.rooms[code] = room
                return room
        raise RoomError("busy")

    def get(self, code: str) -> Room:
        room = self.rooms.get(normalize_code(code))
        if room is None:
            raise RoomError("no_room")
        return room

    def sweep(self) -> None:
        now = time.monotonic()
        for code in [c for c, r in self.rooms.items() if r.empty_since is not None and now - r.empty_since > self.empty_ttl]:
            del self.rooms[code]

    # -- membership --------------------------------------------------------
    def join(self, room: Room) -> Member:
        if len(room.members) >= self.max_members:
            raise RoomError("full")
        member = Member(id=secrets.token_hex(6), token=secrets.token_urlsafe(16), tokens=float(self.msg_burst))
        room.members[member.id] = member
        room.empty_since = None
        self._broadcast(room)
        return member

    def leave(self, room: Room, member: Member) -> None:
        room.members.pop(member.id, None)
        if room.source and room.source.get("kind") == "p2p" and room.source.get("by") == member.id:
            room.source = None
            room.rev += 1
        if not room.members:
            room.empty_since = time.monotonic()
        else:
            self._broadcast(room)

    # -- messages ----------------------------------------------------------
    def _allow(self, member: Member) -> bool:
        now = time.monotonic()
        member.tokens = min(float(self.msg_burst), member.tokens + (now - member.refilled) * self.msg_per_second)
        member.refilled = now
        if member.tokens < 1:
            return False
        member.tokens -= 1
        return True

    def handle(self, room: Room, member_id: str, token: str, msg: dict[str, Any]) -> None:
        member = room.members.get(member_id)
        if member is None or not secrets.compare_digest(member.token, token):
            raise RoomError("no_member")
        if not self._allow(member):
            raise RoomError("slow_down")
        kind = msg.get("t")
        if kind == "source":
            room.source = _clean_source(msg, member.id)
            room.rev += 1
            room.by = member.id
            self._broadcast(room)
            return
        if kind == "media":
            member.dur = None if msg.get("dur") is None else _num(msg.get("dur"), 0, MAX_POSITION)
            self._broadcast(room)
            return
        if kind == "signal":
            target = room.members.get(msg.get("to") or "")
            sig, sdp = msg.get("sig"), msg.get("sdp")
            if target is None or target.id == member.id:
                raise RoomError("no_target")
            if sig not in {"offer", "answer", "bye", "quality"}:
                raise RoomError("bad_value")
            if sig in {"offer", "answer"} and (not isinstance(sdp, str) or not sdp or len(sdp) > MAX_SDP):
                raise RoomError("bad_value")
            if sig == "quality" and (not isinstance(sdp, str) or not QUALITY.match(sdp)):
                raise RoomError("bad_value")
            event = {"t": "signal", "from": member.id, "sig": sig, "sdp": sdp if sig != "bye" else None}
            try:
                target.queue.put_nowait(event)
            except asyncio.QueueFull:
                raise RoomError("slow_down") from None
            return
        if kind not in {"play", "pause", "seek"}:
            raise RoomError("bad_value")
        pos = _num(msg.get("pos"), 0, MAX_POSITION)
        now = now_ms()
        # The sender stamps its position with its own estimate of server time, which makes up for
        # its network delay. Never trust it further than a few seconds, and never from the future.
        at = now
        ts = msg.get("ts")
        if isinstance(ts, (int, float)) and not isinstance(ts, bool) and math.isfinite(ts):
            at = int(min(now, max(now - MAX_CLOCK_SKEW_MS, ts)))
        if kind == "play":
            room.playing = True
        elif kind == "pause":
            room.playing = False
        room.pos = pos
        room.at = at
        room.rev += 1
        room.by = member.id
        self._broadcast(room)

    def _broadcast(self, room: Room) -> None:
        snap = room.snapshot()
        for member in list(room.members.values()):
            try:
                member.queue.put_nowait(snap)
            except asyncio.QueueFull:
                # A stalled consumer only needs the newest state, so drop the backlog and keep that.
                while not member.queue.empty():
                    member.queue.get_nowait()
                member.queue.put_nowait(snap)
