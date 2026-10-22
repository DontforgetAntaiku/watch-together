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


# ---- the room waits for people who are still loading --------------------------------------------------------------

def test_room_holds_while_somebody_loads_and_resumes_from_the_same_spot(monkeypatch):
    import app.rooms as rooms

    clock = {"ms": 1_000_000}
    monkeypatch.setattr(rooms, "now_ms", lambda: clock["ms"])
    m = make(max_members=3)
    r = m.create()
    a, b = m.join(r), m.join(r)
    m.handle(r, a.id, a.token, {"t": "play", "pos": 10.0, "ts": clock["ms"]})
    clock["ms"] += 4000  # four seconds of playing: the playhead stands at 14
    m.handle(r, b.id, b.token, {"t": "buffer", "on": True})
    assert r.hold and r.snapshot()["hold"] is True and r.snapshot()["waiting"] == 1
    assert r.pos == pytest.approx(14.0) and r.at == clock["ms"]
    clock["ms"] += 9000  # nine more seconds pass while B loads: the position must not move on
    m.handle(r, b.id, b.token, {"t": "buffer", "on": False})
    assert not r.hold and r.pos == pytest.approx(14.0) and r.at == clock["ms"]  # resumes from 14, not 23


def test_hold_expires_by_itself_when_the_report_goes_quiet(monkeypatch):
    import app.rooms as rooms

    mono = {"t": rooms.time.monotonic()}  # start from the real clock: members stamp themselves with it
    monkeypatch.setattr(rooms.time, "monotonic", lambda: mono["t"])
    m = make()
    r = m.create()
    a, b = m.join(r), m.join(r)
    m.handle(r, a.id, a.token, {"t": "play", "pos": 0.0})
    m.handle(r, b.id, b.token, {"t": "buffer", "on": True})
    assert r.hold
    mono["t"] += 5
    m.tick()
    assert r.hold  # still reporting recently
    mono["t"] += rooms.HOLD_REFRESH_TTL
    m.tick()
    assert not r.hold  # B went silent (closed laptop): the others carry on


def test_nobody_holds_the_room_for_more_than_the_maximum(monkeypatch):
    import app.rooms as rooms

    mono = {"t": rooms.time.monotonic()}
    monkeypatch.setattr(rooms.time, "monotonic", lambda: mono["t"])
    m = make()
    r = m.create()
    a, b = m.join(r), m.join(r)
    m.handle(r, a.id, a.token, {"t": "play", "pos": 0.0})
    m.handle(r, b.id, b.token, {"t": "buffer", "on": True})
    for _ in range(8):  # B keeps saying "still loading"
        mono["t"] += 5
        m.handle(r, b.id, b.token, {"t": "buffer", "on": True})
    assert not r.hold  # 40 s later: enough, the room goes on without B


def test_no_hold_while_paused_and_leaving_releases_it():
    m = make(max_members=3)
    r = m.create()
    a, b = m.join(r), m.join(r)
    m.handle(r, b.id, b.token, {"t": "buffer", "on": True})
    assert not r.hold  # nothing is playing, so nothing to wait for
    m.handle(r, a.id, a.token, {"t": "play", "pos": 1.0})
    assert r.hold  # playing started while B was already loading
    m.leave(r, b)
    assert not r.hold and r.snapshot()["waiting"] == 0


def test_pause_during_a_hold_ends_it_and_bad_reports_are_rejected():
    m = make()
    r = m.create()
    a, b = m.join(r), m.join(r)
    m.handle(r, a.id, a.token, {"t": "play", "pos": 5.0})
    m.handle(r, b.id, b.token, {"t": "buffer", "on": True})
    assert r.hold
    m.handle(r, a.id, a.token, {"t": "pause", "pos": 5.0})
    assert not r.hold and not r.playing
    for bad in ("yes", 1, None):
        with pytest.raises(RoomError):
            m.handle(r, b.id, b.token, {"t": "buffer", "on": bad})


# ---- the shared watch list ----------------------------------------------------------------------------------------

def three_in_a_room():
    m = make(max_members=4)
    r = m.create()
    return m, r, m.join(r), m.join(r)


def add(m, r, who, url, **extra):
    m.handle(r, who.id, who.token, {"t": "queue_add", "url": url, **extra})
    return r.queue[-1] if r.queue and r.queue[-1]["url"] == url else next(i for i in r.queue if i["url"] == url)


def test_add_play_and_snapshot():
    m, r, a, b = three_in_a_room()
    one = add(m, r, a, "https://v.test/1", title="First")
    assert r.source is None and r.snapshot()["queue"] == [{"id": one["id"], "url": "https://v.test/1", "title": "First", "by": a.id}]
    add(m, r, b, "https://v.test/2", play=True)
    assert r.source["url"] == "https://v.test/2" and r.source["item"] == r.queue[1]["id"] and r.playing and r.pos == 0
    # adding a link that is already listed does not duplicate it, it only plays it
    again = add(m, r, a, "https://v.test/1", play=True)
    assert len(r.queue) == 2 and again["id"] == one["id"] and r.source["item"] == one["id"]


def test_queue_validation_and_limits():
    m, r, a, _ = three_in_a_room()
    for bad in ("javascript:alert(1)", "ftp://x/y", "https://a b", "x" * 1600, None, 5, "https://v.test/" + "a" * 1500):
        with pytest.raises(RoomError):
            m.handle(r, a.id, a.token, {"t": "queue_add", "url": bad})
    with pytest.raises(RoomError):
        m.handle(r, a.id, a.token, {"t": "queue_add", "url": "https://v.test/t", "title": "bad\x00title"})
    for i in range(50):
        m.handle(r, a.id, a.token, {"t": "queue_add", "url": f"https://v.test/{i}"})
    with pytest.raises(RoomError) as e:
        m.handle(r, a.id, a.token, {"t": "queue_add", "url": "https://v.test/one-too-many"})
    assert e.value.code == "queue_full" and len(r.queue) == 50


def test_remove_move_and_missing_items():
    m, r, a, b = three_in_a_room()
    ids = [add(m, r, a, f"https://v.test/{i}")["id"] for i in range(4)]
    m.handle(r, b.id, b.token, {"t": "queue_move", "item": ids[3], "index": 0})
    assert [i["id"] for i in r.queue] == [ids[3], ids[0], ids[1], ids[2]]
    for bad in (-1, 4, "0", None, True):
        with pytest.raises(RoomError):
            m.handle(r, a.id, a.token, {"t": "queue_move", "item": ids[0], "index": bad})
    m.handle(r, a.id, a.token, {"t": "queue_play", "item": ids[1]})
    m.handle(r, a.id, a.token, {"t": "queue_remove", "item": ids[1]})
    assert r.source["url"] == "https://v.test/1" and "item" not in r.source  # keeps playing, no longer listed
    for kind in ("queue_remove", "queue_play", "queue_move", "queue_title"):
        with pytest.raises(RoomError) as e:
            m.handle(r, a.id, a.token, {"t": kind, "item": "nope", "index": 0, "title": "x"})
        assert e.value.code == "no_item"


def test_next_advances_once_even_if_everybody_reports_the_end():
    m, r, a, b = three_in_a_room()
    first, second, third = (add(m, r, a, f"https://v.test/{i}") for i in range(3))
    m.handle(r, a.id, a.token, {"t": "queue_play", "item": first["id"]})
    rev = r.rev
    m.handle(r, a.id, a.token, {"t": "queue_next", "item": first["id"]})
    m.handle(r, b.id, b.token, {"t": "queue_next", "item": first["id"]})  # the second report is stale
    assert r.source["item"] == second["id"] and r.rev == rev + 1
    m.handle(r, b.id, b.token, {"t": "queue_next", "item": second["id"]})
    m.handle(r, a.id, a.token, {"t": "queue_next", "item": third["id"]})  # last one: nothing follows
    assert r.source["item"] == third["id"]


def test_a_new_video_forgets_old_lengths_and_titles_are_set_once():
    m, r, a, b = three_in_a_room()
    one = add(m, r, a, "https://v.test/1", play=True)
    m.handle(r, a.id, a.token, {"t": "media", "dur": 100.0})
    m.handle(r, b.id, b.token, {"t": "media", "dur": 300.0})
    assert r.snapshot()["media"]
    two = add(m, r, a, "https://v.test/2", play=True)
    assert r.snapshot()["media"] is None and all(x.dur is None for x in r.members.values())
    m.handle(r, a.id, a.token, {"t": "queue_title", "item": one["id"], "title": "  Nice film  "})
    m.handle(r, b.id, b.token, {"t": "queue_title", "item": one["id"], "title": "Other"})
    assert one["title"] == "Nice film" and two["title"] is None


def test_a_plain_share_replaces_the_current_item_but_keeps_the_list():
    m, r, a, _ = three_in_a_room()
    one = add(m, r, a, "https://v.test/1", play=True)
    m.handle(r, a.id, a.token, {"t": "source", "kind": "p2p", "name": "film.mkv", "dur": 90})
    assert r.source["kind"] == "p2p" and r.queue == [one]


def test_a_live_share_starts_running_and_can_be_paused_by_a_viewer():
    m = make(max_members=3)
    r = m.create()
    a, b = m.join(r), m.join(r)
    m.handle(r, a.id, a.token, {"t": "pause", "pos": 5.0})  # something earlier left the room paused
    assert not r.playing
    m.handle(r, a.id, a.token, {"t": "source", "kind": "p2p", "name": "tab", "live": True})
    assert r.playing and r.pos == 0.0 and r.snapshot()["source"]["live"] is True
    m.handle(r, b.id, b.token, {"t": "pause", "pos": 0.0})
    assert not r.playing
    m.handle(r, b.id, b.token, {"t": "play", "pos": 0.0})
    assert r.playing
    # a shared FILE does not touch the playhead: its player is the clock
    m.handle(r, a.id, a.token, {"t": "pause", "pos": 9.0})
    m.handle(r, a.id, a.token, {"t": "source", "kind": "p2p", "name": "film.mkv", "dur": 90})
    assert not r.playing and r.pos == 9.0


# -- the ready check -------------------------------------------------------
def drain(*members):
    for m in members:
        while not m.queue.empty():
            m.queue.get_nowait()


def test_ready_check_counts_everybody_then_counts_down(monkeypatch):
    m = make(max_members=3)
    r = m.create()
    a, b, c = m.join(r), m.join(r), m.join(r)
    m.handle(r, a.id, a.token, {"t": "play", "pos": 10})
    drain(a, b, c)
    m.handle(r, a.id, a.token, {"t": "ready_start"})
    s = b.queue.get_nowait()
    assert s["playing"] is False and s["pos"] >= 10 and s["by"] == ""
    assert s["check"]["by"] == a.id and s["check"]["ready"] == [a.id] and s["go"] is None
    m.handle(r, b.id, b.token, {"t": "ready_yes"})
    assert r.check is not None and r.go is None
    m.handle(r, c.id, c.token, {"t": "ready_yes"})
    assert r.check is None and r.go is not None and r.go > now_ms()
    assert r.playing is False
    m.tick_checks()
    assert r.go is not None and r.playing is False  # not yet
    r.go = now_ms() - 1
    drain(a)
    m.tick_checks()
    s = a.queue.get_nowait()
    assert s["playing"] is True and s["go"] is None and s["by"] == ""


def test_ready_check_ends_on_cancel_timeout_and_a_decision():
    m = make(max_members=3)
    r = m.create()
    a, b = m.join(r), m.join(r)
    m.handle(r, a.id, a.token, {"t": "ready_start"})
    m.handle(r, b.id, b.token, {"t": "ready_cancel"})
    assert r.check is None and r.go is None
    m.handle(r, a.id, a.token, {"t": "ready_start"})
    r.check["until"] = now_ms() - 1
    m.tick_checks()
    assert r.check is None and r.playing is False
    m.handle(r, a.id, a.token, {"t": "ready_start"})
    m.handle(r, b.id, b.token, {"t": "play", "pos": 3})  # somebody just pressed play
    assert r.check is None and r.playing is True
    m.handle(r, b.id, b.token, {"t": "ready_yes"})  # no check: nothing happens
    assert r.check is None and r.go is None


def test_ready_check_when_a_member_leaves_or_is_alone():
    m = make(max_members=3)
    r = m.create()
    a = m.join(r)
    m.handle(r, a.id, a.token, {"t": "ready_start"})
    assert r.go is not None  # alone: everybody is ready at once
    m.handle(r, a.id, a.token, {"t": "ready_cancel"})
    b = m.join(r)
    m.handle(r, a.id, a.token, {"t": "ready_start"})
    assert r.check is not None and r.go is None
    m.leave(r, b)  # the one still missing goes away
    assert r.go is not None
    m.leave(r, a)
    assert r.check is None and r.go is None


def test_ready_start_is_one_at_a_time():
    m = make(max_members=3)
    r = m.create()
    a, b = m.join(r), m.join(r)
    m.handle(r, a.id, a.token, {"t": "ready_start"})
    until = r.check["until"]
    m.handle(r, b.id, b.token, {"t": "ready_start"})
    assert r.check["until"] == until and r.check["by"] == a.id


# -- importing several links -----------------------------------------------
def test_queue_import_adds_new_links_and_caps_the_list():
    m = make(max_members=3)
    r = m.create()
    a = m.join(r)
    m.handle(r, a.id, a.token, {"t": "queue_add", "url": "https://x.example/1"})
    m.handle(r, a.id, a.token, {"t": "queue_import", "items": [{"url": "https://x.example/1", "title": "one"}, {"url": "https://x.example/2", "title": " Two "}, {"url": "https://x.example/3"}]})
    assert [q["url"] for q in r.queue] == ["https://x.example/1", "https://x.example/2", "https://x.example/3"]
    assert r.queue[1]["title"] == "Two" and r.queue[2]["title"] is None
    big = [{"url": f"https://y.example/{i}"} for i in range(50)]
    m.handle(r, a.id, a.token, {"t": "queue_import", "items": big})
    assert len(r.queue) == 50
    for bad in (None, [], [{"url": "javascript:alert(1)"}], ["https://x.example"], [{"url": "https://x.example/ a"}]):
        with pytest.raises(RoomError) as e:
            m.handle(r, a.id, a.token, {"t": "queue_import", "items": bad})
        assert e.value.code == "bad_value"
