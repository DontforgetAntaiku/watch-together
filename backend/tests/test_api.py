import httpx
import pytest

from main import create_app


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setenv("BACKEND_DEBUG", "False")
    monkeypatch.setenv("CREATE_PER_MINUTE", "3")
    monkeypatch.setenv("MSG_BURST", "500")
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://watch.example")
    return create_app()


@pytest.fixture
async def client(app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield c


async def test_docs_disabled_without_debug(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert (await client.get(path)).status_code == 404
    assert (await client.get("/api/health")).json() == {"status": "ok"}


async def test_create_and_lookup(client):
    r = await client.post("/api/rooms", headers={"Origin": "https://watch.example"})
    assert r.status_code == 201
    code = r.json()["code"]
    assert (await client.get(f"/api/rooms/{code.lower()}")).json() == {"code": code, "n": 0}
    assert (await client.get("/api/rooms/ZZZZZZ")).status_code == 404
    assert (await client.get("/api/rooms/bad!")).status_code == 404


async def test_origin_enforced(client):
    r = await client.post("/api/rooms", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


async def test_create_rate_limited(client):
    codes = [(await client.post("/api/rooms")).status_code for _ in range(4)]
    assert codes == [201, 201, 201, 429]


async def test_message_validation(client, app):
    code = (await client.post("/api/rooms")).json()["code"]
    room = app.state.rooms.get(code)
    me = app.state.rooms.join(room)
    ok = {"member": me.id, "token": me.token, "t": "play", "pos": 3}
    assert (await client.post(f"/api/rooms/{code}/msg", json=ok)).status_code == 204
    assert (await client.post(f"/api/rooms/{code}/msg", json={**ok, "extra": 1})).status_code == 422
    assert (await client.post(f"/api/rooms/{code}/msg", json={**ok, "token": "bad"})).status_code == 403
    assert (await client.post(f"/api/rooms/{code}/msg", json={**ok, "t": "boom"})).status_code == 422
    assert (await client.post(f"/api/rooms/{code}/msg", json={**ok, "pos": -5})).status_code == 422
    assert (await client.post("/api/rooms/ZZZZZZ/msg", json=ok)).status_code == 404


async def test_source_and_signal_over_http(client, app):
    code = (await client.post("/api/rooms")).json()["code"]
    room = app.state.rooms.get(code)
    a, b = app.state.rooms.join(room), app.state.rooms.join(room)
    url = f"/api/rooms/{code}/msg"
    me = {"member": a.id, "token": a.token}
    assert (await client.post(url, json={**me, "t": "source", "kind": "embed", "provider": "youtube", "id": "aqz-KE-bpKQ"})).status_code == 204
    assert room.source["provider"] == "youtube"
    assert (await client.post(url, json={**me, "t": "source", "kind": "embed", "provider": "youtube", "id": "nope"})).status_code == 422
    assert (await client.post(url, json={**me, "t": "signal", "to": b.id, "sig": "offer", "sdp": "v=0"})).status_code == 204
    assert (await client.post(url, json={**me, "t": "signal", "to": "ghost", "sig": "offer", "sdp": "v=0"})).status_code == 404
    assert (await client.post(url, json={**me, "t": "signal", "to": b.id, "sig": "offer", "sdp": "x" * 31_000})).status_code == 422
    assert (await client.post(url, json={**me, "t": "source", "kind": "p2p", "name": "film.mkv", "dur": 90.5})).status_code == 204
    assert room.source["by"] == a.id


async def test_watch_list_over_http(client, app):
    code = (await client.post("/api/rooms")).json()["code"]
    room = app.state.rooms.get(code)
    a = app.state.rooms.join(room)
    url = f"/api/rooms/{code}/msg"
    me = {"member": a.id, "token": a.token}
    ok = await client.post(url, json={**me, "t": "queue_add", "url": "https://v.test/one", "title": "One", "play": True})
    assert ok.status_code == 204
    assert [i["title"] for i in room.queue] == ["One"] and room.source["item"] == room.queue[0]["id"]
    assert (await client.post(url, json={**me, "t": "queue_add", "url": "javascript:alert(1)"})).status_code == 422
    assert (await client.post(url, json={**me, "t": "queue_play", "item": "nope"})).status_code == 404
    assert (await client.post(url, json={**me, "t": "queue_move", "item": room.queue[0]["id"], "index": 9})).status_code == 422
    assert (await client.post(url, json={**me, "t": "queue_add", "url": "https://v.test/x", "extra": 1})).status_code == 422
    for i in range(49):
        assert (await client.post(url, json={**me, "t": "queue_add", "url": f"https://v.test/{i}"})).status_code == 204
    assert (await client.post(url, json={**me, "t": "queue_add", "url": "https://v.test/last"})).status_code == 409


async def test_lookups_of_codes_are_limited(monkeypatch):
    monkeypatch.setenv("BACKEND_DEBUG", "False")
    monkeypatch.setenv("LOOKUP_PER_MINUTE", "3")
    app = create_app()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        codes = [(await c.get("/api/rooms/ZZZZZZ", headers={"X-Real-IP": "1.1.1.1"})).status_code for _ in range(5)]
        assert codes == [404, 404, 404, 429, 429]
        assert (await c.get("/api/rooms/ZZZZZZ", headers={"X-Real-IP": "2.2.2.2"})).status_code == 404


async def test_one_address_cannot_hold_many_rooms(monkeypatch):
    monkeypatch.setenv("BACKEND_DEBUG", "False")
    monkeypatch.setenv("ROOMS_PER_IP", "2")
    monkeypatch.setenv("CREATE_PER_MINUTE", "100")
    app = create_app()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        ok = [(await c.post("/api/rooms", headers={"X-Real-IP": "1.1.1.1"})).status_code for _ in range(3)]
        assert ok == [201, 201, 429]
        assert (await c.post("/api/rooms", headers={"X-Real-IP": "2.2.2.2"})).status_code == 201
        app.state.rooms.empty_ttl = 0.0  # empty rooms are swept: the address gets its share back
        app.state.rooms.sweep()
        assert (await c.post("/api/rooms", headers={"X-Real-IP": "1.1.1.1"})).status_code == 201


def test_streams_per_address_are_counted():
    from app.limits import Slots

    s = Slots(2)
    assert s.take("a") and s.take("a") and not s.take("a") and s.take("b")
    s.give("a")
    assert s.take("a")
    s.give("a"), s.give("a"), s.give("a"), s.give("a")
    assert s.take("a")
