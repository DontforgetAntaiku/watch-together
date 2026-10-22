from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.resolver import ResolveError

router = APIRouter()

STATUS = {
    "bad_url": 422,
    "blocked_host": 422,
    "unsupported": 422,
    "login": 422,
    "no_single_stream": 422,
    "unavailable": 404,
    "refused": 502,
    "failed": 502,
    "timeout": 504,
    "busy": 503,
    "unavailable_tool": 503,
}


class ResolveBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(max_length=2048)


@router.get("/config")
async def config(request: Request) -> dict[str, bool]:
    """What this server offers, so the page can hide features that are switched off."""
    return {"resolver": request.app.state.resolver is not None}


def _guard(request: Request):
    """The lookup tool when it is on and this caller may use it; the same limit covers every kind of lookup."""
    resolver = request.app.state.resolver
    if resolver is None:
        raise HTTPException(status_code=404, detail="not_found")  # switched off: look like the route does not exist
    settings = request.app.state.settings
    origin = request.headers.get("origin")
    if settings.origins and origin and origin.rstrip("/") not in settings.origins:
        raise HTTPException(status_code=403, detail="bad_origin")
    ip = request.headers.get("x-real-ip") or (request.client.host if request.client else "?")
    if not request.app.state.resolve_limit.hit(ip):
        raise HTTPException(status_code=429, detail="slow_down")
    return resolver


@router.post("/resolve")
async def resolve(body: ResolveBody, request: Request) -> dict:
    resolver = _guard(request)
    try:
        return (await resolver.resolve(body.url)).public()
    except ResolveError as err:
        raise HTTPException(status_code=STATUS.get(err.code, 502), detail=err.code) from err


@router.post("/playlist")
async def playlist(body: ResolveBody, request: Request) -> dict:
    """The links in a playlist (at most 50), to add to the room's watch list."""
    resolver = _guard(request)
    try:
        return {"items": await resolver.playlist(body.url)}
    except ResolveError as err:
        raise HTTPException(status_code=STATUS.get(err.code, 502), detail=err.code) from err
