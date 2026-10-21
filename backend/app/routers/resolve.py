import time
from collections import defaultdict, deque

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


@router.post("/resolve")
async def resolve(body: ResolveBody, request: Request) -> dict:
    resolver = request.app.state.resolver
    if resolver is None:
        raise HTTPException(status_code=404, detail="not_found")  # switched off: look like the route does not exist
    settings = request.app.state.settings
    origin = request.headers.get("origin")
    if settings.origins and origin and origin.rstrip("/") not in settings.origins:
        raise HTTPException(status_code=403, detail="bad_origin")
    ip = request.headers.get("x-real-ip") or (request.client.host if request.client else "?")
    hits: defaultdict[str, deque[float]] = request.app.state.resolve_hits
    bucket = hits[ip]
    now = time.monotonic()
    while bucket and now - bucket[0] > 60:
        bucket.popleft()
    if len(bucket) >= settings.resolver_per_minute:
        raise HTTPException(status_code=429, detail="slow_down")
    bucket.append(now)
    if len(hits) > 5000:
        for key in [k for k, v in hits.items() if not v or now - v[-1] > 60]:
            del hits[key]
    try:
        return (await resolver.resolve(body.url)).public()
    except ResolveError as err:
        raise HTTPException(status_code=STATUS.get(err.code, 502), detail=err.code) from err
