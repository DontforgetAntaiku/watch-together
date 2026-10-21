import httpx
import pytest

from main import create_app


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setenv("BACKEND_DEBUG", "False")
    monkeypatch.setenv("CREATE_PER_MINUTE", "3")
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
