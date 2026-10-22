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
    lookup_per_minute: int
    streams_per_ip: int
    rooms_per_ip: int
    msg_per_second: float
    msg_burst: int
    resolver: bool
    resolver_hosts: tuple[str, ...]
    resolver_timeout: float
    resolver_concurrent: int
    resolver_per_minute: int
    resolver_proxy: str
    resolver_cache_ttl: float


def load_settings() -> Settings:
    origins = tuple(o.strip().rstrip("/") for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip())
    return Settings(
        debug=_flag("BACKEND_DEBUG", True),
        origins=origins,
        max_rooms=int(os.getenv("MAX_ROOMS", "5000")),
        max_members=int(os.getenv("MAX_MEMBERS", "30")),
        empty_room_ttl=float(os.getenv("EMPTY_ROOM_TTL", "1800")),
        create_per_minute=int(os.getenv("CREATE_PER_MINUTE", "20")),
        lookup_per_minute=int(os.getenv("LOOKUP_PER_MINUTE", "60")),
        streams_per_ip=int(os.getenv("STREAMS_PER_IP", "20")),
        rooms_per_ip=int(os.getenv("ROOMS_PER_IP", "10")),
        msg_per_second=float(os.getenv("MSG_PER_SECOND", "10")),
        msg_burst=int(os.getenv("MSG_BURST", "30")),
        resolver=_flag("RESOLVER_ENABLED", False),
        resolver_hosts=tuple(h.strip().lower().lstrip(".") for h in os.getenv("RESOLVER_ALLOWED_HOSTS", "").split(",") if h.strip()),
        resolver_timeout=float(os.getenv("RESOLVER_TIMEOUT", "25")),
        resolver_concurrent=int(os.getenv("RESOLVER_MAX_CONCURRENT", "2")),
        resolver_per_minute=int(os.getenv("RESOLVER_PER_MINUTE", "6")),
        resolver_proxy=os.getenv("RESOLVER_PROXY", "").strip(),
        resolver_cache_ttl=float(os.getenv("RESOLVER_CACHE_TTL", "600")),
    )
