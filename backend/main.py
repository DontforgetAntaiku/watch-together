import asyncio
from collections import defaultdict, deque
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI

from app.rooms import RoomManager
from app.routers import routers
from app.settings import load_settings


def create_app() -> FastAPI:
    settings = load_settings()
    manager = RoomManager(
        max_rooms=settings.max_rooms,
        max_members=settings.max_members,
        empty_ttl=settings.empty_room_ttl,
        msg_per_second=settings.msg_per_second,
        msg_burst=settings.msg_burst,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
        async def janitor() -> None:
            while True:
                await asyncio.sleep(60)
                manager.sweep()

        task = asyncio.create_task(janitor())
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    docs = {} if settings.debug else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    app = FastAPI(title="watch-together", debug=False, lifespan=lifespan, **docs)
    app.state.settings = settings
    app.state.rooms = manager
    app.state.create_hits = defaultdict(deque)
    for router in routers:
        app.include_router(router, prefix="/api")
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app=app, host="0.0.0.0", port=8000)
