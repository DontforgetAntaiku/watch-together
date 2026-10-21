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
        m.handle(r, a.id, a.token, {"t": "source", "url": url})


def test_source_set_and_cleared():
    m = make()
    r = m.create()
    a = m.join(r)
    m.handle(r, a.id, a.token, {"t": "source", "url": "https://x.test/a.m3u8"})
    assert r.snapshot()["source"] == "https://x.test/a.m3u8"
    m.handle(r, a.id, a.token, {"t": "source", "url": None})
    assert r.source is None


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
