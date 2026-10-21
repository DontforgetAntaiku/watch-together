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
    ok = [
        {"provider": "youtube", "id": "dQw4w9WgXcQ"},
        {"provider": "vimeo", "id": "76979871", "hash": "abcdef1234"},
        {"provider": "streamable", "id": "moo"},
        {"provider": "twitch", "type": "video", "id": "2902385151"},
        {"provider": "twitch", "type": "channel", "id": "twitch"},
        {"provider": "twitch", "type": "clip", "id": "FriendlyAmazingSlothFutureMan"},
    ]
    for source in ok:
        m.handle(r, a.id, a.token, {"t": "source", "kind": "embed", **source})
        assert r.source["provider"] == source["provider"] and r.source["by"] == a.id
    assert r.source["type"] == "clip"


@pytest.mark.parametrize("bad", [
    {"provider": "youtube", "id": "short"},
    {"provider": "youtube", "id": "a b c d e f g"},
    {"provider": "youtube", "id": "dQw4w9WgXcQ/../../x"},
    {"provider": "vimeo", "id": "abc"},
    {"provider": "vimeo", "id": "1", "hash": "ZZ"},
    {"provider": "rutube", "id": "d07af4321b54d2e8a46b4fe015081314"},
    {"provider": "streamable", "id": "../x"},
    {"provider": "twitch", "id": "twitch"},
    {"provider": "twitch", "type": "video", "id": "twitch"},
    {"provider": "twitch", "type": "channel", "id": "no spaces"},
    {"provider": "nope", "id": "x"},
    {"id": "dQw4w9WgXcQ"},
    {"provider": "youtube", "id": 12345678901},
])
def test_bad_embed_rejected(bad):
    m = make()
    r = m.create()
    a = m.join(r)
    with pytest.raises(RoomError):
        m.handle(r, a.id, a.token, {"t": "source", "kind": "embed", **bad})
    assert r.source is None


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


def test_quality_signal_relayed_and_validated():
    m = make()
    r = m.create()
    a, b = m.join(r), m.join(r)
    for member in (a, b):
        while not member.queue.empty():
            member.queue.get_nowait()
    for value in ("auto", "720", "1080"):
        m.handle(r, b.id, b.token, {"t": "signal", "to": a.id, "sig": "quality", "sdp": value})
    assert [a.queue.get_nowait()["sdp"] for _ in range(3)] == ["auto", "720", "1080"]
    for bad in ("0", "12", "99999", "720p", "", None, "auto; drop"):
        with pytest.raises(RoomError):
            m.handle(r, b.id, b.token, {"t": "signal", "to": a.id, "sig": "quality", "sdp": bad})


def test_media_mismatch_reported_only_when_lengths_differ():
    m = make(max_members=3)
    r = m.create()
    a, b, c = m.join(r), m.join(r), m.join(r)
    m.handle(r, a.id, a.token, {"t": "media", "dur": 3600.0})
    assert r.snapshot()["media"] is None  # one report is nothing to compare
    m.handle(r, b.id, b.token, {"t": "media", "dur": 3600.4})
    assert r.snapshot()["media"] is None  # within tolerance
    m.handle(r, c.id, c.token, {"t": "media", "dur": 3512.0})
    assert r.snapshot()["media"] == {"lo": 3512.0, "hi": 3600.4, "n": 3}
    m.leave(r, c)
    assert r.snapshot()["media"] is None
    m.handle(r, b.id, b.token, {"t": "media", "dur": None})
    assert r.snapshot()["media"] is None


@pytest.mark.parametrize("dur", [-1, "5", float("nan"), 1e9, True])
def test_bad_media_duration_rejected(dur):
    m = make()
    r = m.create()
    a = m.join(r)
    with pytest.raises(RoomError):
        m.handle(r, a.id, a.token, {"t": "media", "dur": dur})


def test_link_source_may_carry_a_separate_audio_file():
    m = make()
    r = m.create()
    a = m.join(r)
    m.handle(r, a.id, a.token, {"t": "source", "kind": "link", "url": "https://v.test/video.mp4", "audio": "https://v.test/audio.m4a"})
    assert r.source == {"kind": "link", "url": "https://v.test/video.mp4", "audio": "https://v.test/audio.m4a", "by": a.id}
    m.handle(r, a.id, a.token, {"t": "source", "kind": "link", "url": "https://v.test/video.mp4"})
    assert "audio" not in r.source
    for bad in ("javascript:alert(1)", "https://a b", "x" * 5000):
        with pytest.raises(RoomError):
            m.handle(r, a.id, a.token, {"t": "source", "kind": "link", "url": "https://v.test/video.mp4", "audio": bad})
