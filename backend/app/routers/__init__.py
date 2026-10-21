from .resolve import router as resolve
from .rooms import router as rooms

routers = (rooms, resolve)

__all__ = ["routers"]
