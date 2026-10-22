"""In-memory rooms. Nothing is stored on disk; a restart simply empties the rooms."""

import asyncio
import math
import re
import secrets
import time
from dataclasses import dataclass, field
from collections.abc import Callable
from typing import Any

# No 0/O/1/I/L: a code is read aloud and typed by hand.
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6
MAX_POSITION = 60 * 60 * 24  # a day, far beyond any video
MAX_URL = 4096  # signed CDN links are long
MAX_CLOCK_SKEW_MS = 3000
MAX_SDP = 30_000
MAX_QUEUE = 50
MAX_QUEUE_URL = 1500
MAX_TITLE = 200
HOLD_REFRESH_TTL = 12.0  # a loading player repeats its report every few seconds; silence for this long ends it
HOLD_MAX = 30.0  # nobody can hold the room for longer than this in one go
CHECK_TTL_MS = 45_000  # a ready check that nobody finishes ends by itself
COUNTDOWN_MS = 3000  # "3, 2, 1" after everybody said they are ready
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
    buf_since: float | None = None  # monotonic time at which this member started waiting for data
    buf_seen: float = 0.0
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
    hold: bool = False  # the playhead stands still because somebody is still loading
    queue: list[dict[str, Any]] = field(default_factory=list)  # the shared watch list: {id, url, title, by}
    by: str = ""
    check: dict[str, Any] | None = None  # a ready check in progress: {by, ready: set of member ids, until: epoch ms}
    go: int | None = None  # epoch ms at which the countdown ends and everybody starts
    owner: str = ""  # the address that created the room (for the per-address room limit)
    on_gone: Callable[[str], None] | None = None
    source: dict[str, Any] | None = None  # what the room offers to watch (a link, an embed or a P2P share)
    empty_since: float | None = field(default_factory=time.monotonic)

    def media(self) -> dict[str, float | int] | None:
        """Set when people who opened their own copy report clearly different lengths (probably different cuts)."""
        durs = [m.dur for m in self.members.values() if m.dur is not None]
        if len(durs) < 2 or max(durs) - min(durs) <= MEDIA_TOLERANCE:
            return None
        return {"lo": min(durs), "hi": max(durs), "n": len(durs)}

    def waiting(self, now: float | None = None) -> int:
        """How many people are holding the room right now."""
        now = time.monotonic() if now is None else now
        return sum(
            1
            for m in self.members.values()
            if m.buf_since is not None and now - m.buf_seen <= HOLD_REFRESH_TTL and now - m.buf_since <= HOLD_MAX
        )

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
            "queue": self.queue,
            "hold": self.hold,
            "waiting": self.waiting() if self.hold else 0,
            "check": None if self.check is None else {"by": self.check["by"], "ready": sorted(self.check["ready"]), "until": self.check["until"]},
            "go": self.go,
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


def _clean_title(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str) or any(ord(ch) < 32 for ch in value):
        raise RoomError("bad_value")
    return value.strip()[:MAX_TITLE] or None


class RoomManager:
    def __init__(self, max_rooms: int, max_members: int, empty_ttl: float, msg_per_second: float, msg_burst: int):
        self.rooms: dict[str, Room] = {}
        self.max_rooms = max_rooms
        self.max_members = max_members
        self.empty_ttl = empty_ttl
        self.msg_per_second = msg_per_second
        self.msg_burst = msg_burst

    # -- lifecycle ---------------------------------------------------------
    def create(self, owner: str = "", on_gone: Callable[[str], None] | None = None) -> Room:
        self.sweep()
        if len(self.rooms) >= self.max_rooms:
            raise RoomError("busy")
        for _ in range(20):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            if code not in self.rooms:
                room = Room(code=code, owner=owner, on_gone=on_gone)
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
            room = self.rooms.pop(code)
            if room.on_gone and room.owner:
                room.on_gone(room.owner)

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
        if room.check is not None:
            room.check["ready"].discard(member.id)
        if not room.members:
            room.empty_since = time.monotonic()
            room.hold = False
            self._clear_check(room)
        else:
            if self._all_ready(room):
                self._begin_countdown(room)
            self._update_hold(room)
            self._broadcast(room)

    # -- the ready check ----------------------------------------------------
    @staticmethod
    def _clear_check(room: Room) -> None:
        """Somebody pressed play, paused, seeked or changed the video: the check (or countdown) is over."""
        room.check = None
        room.go = None

    @staticmethod
    def _begin_countdown(room: Room) -> None:
        room.check = None
        room.go = now_ms() + COUNTDOWN_MS

    @staticmethod
    def _all_ready(room: Room) -> bool:
        return room.check is not None and bool(room.members) and all(mid in room.check["ready"] for mid in room.members)

    def _ready(self, room: Room, member: Member, kind: str) -> None:
        if kind == "ready_start":
            if room.check is not None or room.go is not None:
                return  # one at a time
            now = now_ms()
            if room.playing and not room.hold:
                room.pos += max(0, now - room.at) / 1000  # stand still where everybody is now
            room.playing = False
            room.hold = False
            room.at = now
            room.rev += 1
            room.by = ""  # nobody's echo: every player applies it, the one who asked as well
            room.check = {"by": member.id, "ready": {member.id}, "until": now + CHECK_TTL_MS}
        elif kind == "ready_yes":
            if room.check is None:
                return
            room.check["ready"].add(member.id)
        elif room.check is None and room.go is None:  # ready_cancel
            return
        else:
            self._clear_check(room)
        if self._all_ready(room):
            self._begin_countdown(room)
        self._broadcast(room)

    def tick_checks(self) -> None:
        """Called several times a second: a ready check can run out, and a countdown must end on time."""
        for room in list(self.rooms.values()):
            if room.check is None and room.go is None:
                continue
            now = now_ms()
            if room.check is not None and now >= room.check["until"]:
                room.check = None
                self._broadcast(room)
            elif room.go is not None and now >= room.go:
                room.go = None
                room.playing = True
                room.hold = False
                room.at = now
                room.rev += 1
                room.by = ""
                self._broadcast(room)

    # -- the shared watch list ----------------------------------------------
    def _play_item(self, room: Room, member_id: str, item: dict[str, Any]) -> None:
        room.source = {"kind": "link", "url": item["url"], "item": item["id"], "by": member_id}
        self._clear_check(room)
        room.playing = True
        room.pos = 0.0
        room.at = now_ms()
        room.hold = False
        room.rev += 1
        room.by = member_id
        for m in room.members.values():
            m.dur = None  # everybody loads a new video: forget the old lengths

    def _queue(self, room: Room, member: Member, kind: str, msg: dict[str, Any]) -> None:
        def find(item_id: Any) -> int:
            for i, it in enumerate(room.queue):
                if it["id"] == item_id:
                    return i
            raise RoomError("no_item")

        if kind == "queue_add":
            url = _clean_url(msg.get("url"))
            if url is None or len(url) > MAX_QUEUE_URL:
                raise RoomError("bad_value")
            title = _clean_title(msg.get("title"))
            existing = next((it for it in room.queue if it["url"] == url), None)
            if existing is None:
                if len(room.queue) >= MAX_QUEUE:
                    raise RoomError("queue_full")
                existing = {"id": secrets.token_hex(4), "url": url, "title": title, "by": member.id}
                room.queue.append(existing)
            elif title and not existing.get("title"):
                existing["title"] = title
            if msg.get("play") is True:
                self._play_item(room, member.id, existing)
        elif kind == "queue_import":
            items = msg.get("items")
            if not isinstance(items, list) or not items or len(items) > MAX_QUEUE:
                raise RoomError("bad_value")
            have = {it["url"] for it in room.queue}
            for raw in items:
                if not isinstance(raw, dict):
                    raise RoomError("bad_value")
                url = _clean_url(raw.get("url"))
                if url is None or len(url) > MAX_QUEUE_URL:
                    raise RoomError("bad_value")
                if url in have:
                    continue
                if len(room.queue) >= MAX_QUEUE:
                    break  # as many as fit
                have.add(url)
                room.queue.append({"id": secrets.token_hex(4), "url": url, "title": _clean_title(raw.get("title")), "by": member.id})
        elif kind == "queue_remove":
            removed = room.queue.pop(find(msg.get("item")))
            if room.source and room.source.get("item") == removed["id"]:
                room.source = {k: v for k, v in room.source.items() if k != "item"}  # it keeps playing, it just is no longer listed
        elif kind == "queue_move":
            index = msg.get("index")
            if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < len(room.queue):
                raise RoomError("bad_value")
            room.queue.insert(index, room.queue.pop(find(msg.get("item"))))
        elif kind == "queue_play":
            self._play_item(room, member.id, room.queue[find(msg.get("item"))])
        elif kind == "queue_next":
            # Everybody's player reports "ended"; only the first report counts, later ones name an item that is no longer current.
            if not room.source or room.source.get("item") != msg.get("item"):
                return
            i = find(msg.get("item"))
            if i + 1 >= len(room.queue):
                return
            self._play_item(room, member.id, room.queue[i + 1])
        elif kind == "queue_title":
            item = room.queue[find(msg.get("item"))]
            title = _clean_title(msg.get("title"))
            if not title or item.get("title"):
                return  # the first one to learn the title wins
            item["title"] = title
        else:
            raise RoomError("bad_value")
        self._broadcast(room)

    # -- waiting for slow players ------------------------------------------
    def _update_hold(self, room: Room) -> bool:
        """Freeze the playhead while somebody loads, let it run again when they are done. True when it changed."""
        want = room.playing and room.waiting() > 0
        if want == room.hold:
            return False
        now = now_ms()
        if want:
            room.pos += max(0, now - room.at) / 1000  # the position they are all standing at
        room.at = now
        room.hold = want
        room.rev += 1
        room.by = ""
        return True

    def tick(self) -> None:
        """Called every couple of seconds: reports expire, so a hold can end without anybody saying anything."""
        for room in list(self.rooms.values()):
            if (room.hold or any(m.buf_since is not None for m in room.members.values())) and self._update_hold(room):
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
            room.source = _clean_source(msg, member.id)  # a share or a plain link: not a list item any more
            self._clear_check(room)
            if room.source and room.source.get("kind") == "p2p" and room.source.get("live"):
                # A live share has no playhead, only "running" or "paused" (viewers can pause it for everybody); it starts running.
                room.playing = True
                room.pos = 0.0
                room.at = now_ms()
                room.hold = False
            room.rev += 1
            room.by = member.id
            self._broadcast(room)
            return
        if kind.startswith("queue_"):
            self._queue(room, member, kind, msg)
            return
        if kind in {"ready_start", "ready_yes", "ready_cancel"}:
            self._ready(room, member, kind)
            return
        if kind == "buffer":
            on = msg.get("on")
            if not isinstance(on, bool):
                raise RoomError("bad_value")
            seen = time.monotonic()
            if on:
                if member.buf_since is None:
                    member.buf_since = seen
                member.buf_seen = seen
            else:
                member.buf_since = None
            before = room.waiting()
            changed = self._update_hold(room)
            if changed or (room.hold and room.waiting() != before):
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
        self._clear_check(room)  # a person decided: no more waiting for the others
        if kind == "play":
            room.playing = True
        elif kind == "pause":
            room.playing = False
        room.pos = pos
        room.at = at
        room.rev += 1
        room.by = member.id
        self._update_hold(room)  # playing or pausing may start or end a wait
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
