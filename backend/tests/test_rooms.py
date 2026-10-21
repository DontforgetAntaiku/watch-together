import pytest

from app.rooms import RoomError, RoomManager, now_ms, valid_code


def make(**kw) -> RoomManager:
    args = dict(max_rooms=5, max_members=2, empty_ttl=0.0, msg_per_second=1000.0, msg_burst=1000)
    args.update(kw)
    return RoomManager(**args)


def test_codes_are_valid_and_unique():
    m = make(max_rooms=200)
    codes = {m.create().code for _ in range(150)}
    assert len(codes) == 150
    assert all(valid_code(c) for c in codes)


def test_room_limit():
    m = make(max_rooms=2, empty_ttl=999)
    m.create(), m.create()
    with pytest.raises(RoomError) as e:
        m.create()
    assert e.value.code == "busy"


def test_join_full_and_leave():
    m = make()
    r = m.create()
    a, b = m.join(r), m.join(r)
    with pytest.raises(RoomError) as e:
        m.join(r)
    assert e.value.code == "full"
    m.leave(r, a)
    assert len(r.members) == 1
    assert b.queue.get_nowait()["n"] >= 1


def test_play_pause_seek_broadcast():
    m = make()
    r = m.create()
    a, b = m.join(r), m.join(r)
    while not b.queue.empty():
        b.queue.get_nowait()
    m.handle(r, a.id, a.token, {"t": "play", "pos": 12.5})
    s = b.queue.get_nowait()
    assert s["playing"] is True and s["pos"] == 12.5 and s["by"] == a.id
    m.handle(r, a.id, a.token, {"t": "seek", "pos": 99})
    assert r.playing is True and r.pos == 99
    m.handle(r, b.id, b.token, {"t": "pause", "pos": 100})
    assert r.playing is False and r.rev == 3


def test_timestamp_is_clamped():
    m = make()
    r = m.create()
    a = m.join(r)
    m.handle(r, a.id, a.token, {"t": "play", "pos": 1, "ts": now_ms() + 60_000})
    assert r.at <= now_ms()
    m.handle(r, a.id, a.token, {"t": "play", "pos": 1, "ts": 5})
    assert r.at >= now_ms() - 3100


@pytest.mark.parametrize("pos", [-1, 1e9, float("nan"), "7", None, True])
def test_bad_position_rejected(pos):
    m = make()
    r = m.create()
    a = m.join(r)
    with pytest.raises(RoomError):
        m.handle(r, a.id, a.token, {"t": "seek", "pos": pos})
    assert r.rev == 0


def test_wrong_token_and_unknown_member():
    m = make()
    r = m.create()
    a = m.join(r)
    with pytest.raises(RoomError) as e:
        m.handle(r, a.id, "nope", {"t": "pause", "pos": 1})
    assert e.value.code == "no_member"
    with pytest.raises(RoomError):
        m.handle(r, "ghost", a.token, {"t": "pause", "pos": 1})


def test_rate_limit():
    m = make(msg_per_second=0.001, msg_burst=3)
    r = m.create()
    a = m.join(r)
    for _ in range(3):
        m.handle(r, a.id, a.token, {"t": "pause", "pos": 1})
    with pytest.raises(RoomError) as e:
        m.handle(r, a.id, a.token, {"t": "pause", "pos": 1})
    assert e.value.code == "slow_down"


@pytest.mark.parametrize("url", ["javascript:alert(1)", "ftp://x/y", "https://a b", "x" * 3000, 5])
def test_bad_source_rejected(url):
    m = make()
    r = m.create()
    a = m.join(r)
    with pytest.raises(RoomError):
        m.handle(r, a.id, a.token, {"t": "source", "kind": "link", "url": url})


def test_source_set_and_cleared():
    m = make()
    r = m.create()
    a = m.join(r)
    m.handle(r, a.id, a.token, {"t": "source", "kind": "link", "url": "https://x.test/a.m3u8"})
    assert r.snapshot()["source"] == {"kind": "link", "url": "https://x.test/a.m3u8", "by": a.id}
    m.handle(r, a.id, a.token, {"t": "source", "kind": None})
    assert r.source is None


def test_embed_sources_validated():
    m = make()
    r = m.create()
    a = m.join(r)
    m.handle(r, a.id, a.token, {"t": "source", "kind": "yt", "id": "dQw4w9WgXcQ"})
    assert r.source["id"] == "dQw4w9WgXcQ"
    m.handle(r, a.id, a.token, {"t": "source", "kind": "vimeo", "id": "76979871", "hash": "abcdef1234"})
    assert r.source["hash"] == "abcdef1234"
    for bad in ({"kind": "yt", "id": "short"}, {"kind": "yt", "id": "a b c d e f g"}, {"kind": "vimeo", "id": "abc"},
                {"kind": "vimeo", "id": "1", "hash": "ZZ"}, {"kind": "nope"}):
        with pytest.raises(RoomError):
            m.handle(r, a.id, a.token, {"t": "source", **bad})


def test_p2p_source_cleared_when_sharer_leaves():
    m = make()
    r = m.create()
    a, b = m.join(r), m.join(r)
    m.handle(r, a.id, a.token, {"t": "source", "kind": "p2p", "name": "film.mkv", "dur": 600})
    assert r.source["kind"] == "p2p" and r.source["by"] == a.id
    m.leave(r, b)
    assert r.source is not None
    m.leave(r, a)
    assert r.source is None


@pytest.mark.parametrize("extra", [{"name": ""}, {"name": "x" * 200}, {"name": "ok", "dur": -4}, {"name": "ok", "dur": "7"}])
def test_bad_p2p_source_rejected(extra):
    m = make()
    r = m.create()
    a = m.join(r)
    with pytest.raises(RoomError):
        m.handle(r, a.id, a.token, {"t": "source", "kind": "p2p", **extra})


def test_signal_relay_only_to_target():
    m = make(max_members=3)
    r = m.create()
    a, b, c = m.join(r), m.join(r), m.join(r)
    for x in (a, b, c):
        while not x.queue.empty():
            x.queue.get_nowait()
    m.handle(r, a.id, a.token, {"t": "signal", "to": b.id, "sig": "offer", "sdp": "v=0"})
    assert b.queue.get_nowait() == {"t": "signal", "from": a.id, "sig": "offer", "sdp": "v=0"}
    assert a.queue.empty() and c.queue.empty() and r.rev == 0


@pytest.mark.parametrize("bad", [
    {"to": "ghost", "sig": "offer", "sdp": "v=0"},
    {"to": None, "sig": "offer", "sdp": "v=0"},
    {"to": "B", "sig": "weird", "sdp": "v=0"},
    {"to": "B", "sig": "offer"},
    {"to": "B", "sig": "answer", "sdp": "x" * 40_000},
])
def test_bad_signal_rejected(bad):
    m = make()
    r = m.create()
    a, b = m.join(r), m.join(r)
    msg = {"t": "signal", **{k: (b.id if v == "B" else v) for k, v in bad.items()}}
    with pytest.raises(RoomError):
        m.handle(r, a.id, a.token, msg)


def test_cannot_signal_yourself():
    m = make()
    r = m.create()
    a = m.join(r)
    with pytest.raises(RoomError):
        m.handle(r, a.id, a.token, {"t": "signal", "to": a.id, "sig": "bye"})


def test_empty_rooms_swept_only_when_empty():
    m = make(empty_ttl=0.0)
    r = m.create()
    a = m.join(r)
    m.sweep()
    assert r.code in m.rooms
    m.leave(r, a)
    m.sweep()
    assert r.code not in m.rooms


def test_slow_consumer_keeps_latest_state():
    m = make()
    r = m.create()
    a, b = m.join(r), m.join(r)
    for i in range(200):
        m.handle(r, a.id, a.token, {"t": "seek", "pos": i})
    last = None
    while not b.queue.empty():
        last = b.queue.get_nowait()
    assert last["pos"] == 199
