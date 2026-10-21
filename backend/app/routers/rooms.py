import asyncio
import json
import time
from collections import defaultdict, deque
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.rooms import Room, RoomError, RoomManager, now_ms, valid_code, normalize_code
from app.settings import Settings

router = APIRouter()

STATUS = {"no_item": 404, "queue_full": 409, "no_target": 404, "no_room": 404, "full": 409, "busy": 503, "no_member": 403, "slow_down": 429, "bad_value": 422}
KEEPALIVE_SECONDS = 15


class Message(BaseModel):
    model_config = ConfigDict(extra="forbid")

    member: str = Field(max_length=32)
    token: str = Field(max_length=64)
    t: str = Field(max_length=16)
    pos: float | None = None
    ts: float | None = None
    url: str | None = Field(default=None, max_length=4096)
    audio: str | None = Field(default=None, max_length=4096)
    kind: str | None = Field(default=None, max_length=16)
    id: str | None = Field(default=None, max_length=100)
    provider: str | None = Field(default=None, max_length=16)
    type: str | None = Field(default=None, max_length=16)
    hash: str | None = Field(default=None, max_length=32)
    name: str | None = Field(default=None, max_length=120)
    dur: float | None = None
    live: bool | None = None
    on: bool | None = None
    item: str | None = Field(default=None, max_length=16)
    title: str | None = Field(default=None, max_length=300)
    index: int | None = None
    play: bool | None = None
    to: str | None = Field(default=None, max_length=32)
    sig: str | None = Field(default=None, max_length=16)
    sdp: str | None = Field(default=None, max_length=30_000)


def _manager(request: Request) -> RoomManager:
    return request.app.state.rooms


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _client_ip(request: Request) -> str:
    # The backend is published on 127.0.0.1 only, so the host nginx is the only caller that can set this.
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "?")


def _fail(err: RoomError) -> HTTPException:
    return HTTPException(status_code=STATUS.get(err.code, 400), detail=err.code)


def _room_or_404(request: Request, code: str) -> Room:
    code = normalize_code(code)
    if not valid_code(code):
        raise HTTPException(status_code=404, detail="no_room")
    try:
        return _manager(request).get(code)
    except RoomError as err:
        raise _fail(err) from err


def _check_origin(request: Request) -> None:
    allowed = _settings(request).origins
    origin = request.headers.get("origin")
    if allowed and origin and origin.rstrip("/") not in allowed:
        raise HTTPException(status_code=403, detail="bad_origin")


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/time")
async def server_time() -> JSONResponse:
    return JSONResponse({"t": now_ms()}, headers={"Cache-Control": "no-store"})


@router.post("/rooms", status_code=201)
async def create_room(request: Request) -> dict[str, str]:
    _check_origin(request)
    settings = _settings(request)
    hits: defaultdict[str, deque[float]] = request.app.state.create_hits
    bucket = hits[_client_ip(request)]
    now = time.monotonic()
    while bucket and now - bucket[0] > 60:
        bucket.popleft()
    if len(bucket) >= settings.create_per_minute:
        raise HTTPException(status_code=429, detail="slow_down")
    bucket.append(now)
    if len(hits) > 10_000:
        for ip in [k for k, v in hits.items() if not v or now - v[-1] > 60]:
            del hits[ip]
    try:
        room = _manager(request).create()
    except RoomError as err:
        raise _fail(err) from err
    return {"code": room.code}


@router.get("/rooms/{code}")
async def room_info(code: str, request: Request) -> dict[str, Any]:
    room = _room_or_404(request, code)
    return {"code": room.code, "n": len(room.members)}


def _sse(event: dict[str, Any]) -> bytes:
    return f"data: {json.dumps(event, separators=(',', ':'))}\n\n".encode()


@router.get("/rooms/{code}/events")
async def events(code: str, request: Request) -> StreamingResponse:
    _check_origin(request)
    room = _room_or_404(request, code)
    manager = _manager(request)
    try:
        member = manager.join(room)
    except RoomError as err:
        raise _fail(err) from err

    async def stream() -> AsyncIterator[bytes]:
        try:
            yield b"retry: 2000\n\n"
            yield _sse({"t": "hello", "me": member.id, "token": member.token, "now": now_ms()})
            yield _sse(room.snapshot())
            while True:
                try:
                    event = await asyncio.wait_for(member.queue.get(), timeout=KEEPALIVE_SECONDS)
                except TimeoutError:
                    # A data event (not a comment) so the client can tell the stream is alive.
                    yield _sse({"t": "ping"})
                    continue
                yield _sse(event)
        finally:
            manager.leave(room, member)

    headers = {"Cache-Control": "no-store", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff"}
    return StreamingResponse(stream(), media_type="text/event-stream", headers=headers)


@router.post("/rooms/{code}/msg", status_code=204)
async def post_message(code: str, body: Message, request: Request) -> None:
    _check_origin(request)
    room = _room_or_404(request, code)
    try:
        _manager(request).handle(room, body.member, body.token, body.model_dump(exclude={"member", "token"}))
    except RoomError as err:
        raise _fail(err) from err
