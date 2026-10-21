import os
from dataclasses import dataclass


def _flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    debug: bool
    origins: tuple[str, ...]
    max_rooms: int
    max_members: int
    empty_room_ttl: float
    create_per_minute: int
    msg_per_second: float
    msg_burst: int


def load_settings() -> Settings:
    origins = tuple(o.strip().rstrip("/") for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip())
    return Settings(
        debug=_flag("BACKEND_DEBUG", True),
        origins=origins,
        max_rooms=int(os.getenv("MAX_ROOMS", "5000")),
        max_members=int(os.getenv("MAX_MEMBERS", "30")),
        empty_room_ttl=float(os.getenv("EMPTY_ROOM_TTL", "1800")),
        create_per_minute=int(os.getenv("CREATE_PER_MINUTE", "20")),
        msg_per_second=float(os.getenv("MSG_PER_SECOND", "10")),
        msg_burst=int(os.getenv("MSG_BURST", "30")),
    )
