"""Per-address limits against abuse. Everything lives in memory and forgets itself."""

import time
from collections import defaultdict, deque


class RateLimit:
    """At most `per_minute` hits per key in any minute."""

    def __init__(self, per_minute: int, window: float = 60.0, max_keys: int = 10_000):
        self.per_minute = per_minute
        self.window = window
        self.max_keys = max_keys
        self._hits: defaultdict[str, deque[float]] = defaultdict(deque)

    def hit(self, key: str) -> bool:
        """Count one use; False when the key has used up its share."""
        now = time.monotonic()
        bucket = self._hits[key]
        while bucket and now - bucket[0] > self.window:
            bucket.popleft()
        if len(bucket) >= self.per_minute:
            return False
        bucket.append(now)
        if len(self._hits) > self.max_keys:
            for k in [k for k, v in self._hits.items() if not v or now - v[-1] > self.window]:
                del self._hits[k]
        return True


class Slots:
    """At most `limit` things open at once per key (event streams, rooms)."""

    def __init__(self, limit: int):
        self.limit = limit
        self._open: dict[str, int] = {}

    def take(self, key: str) -> bool:
        if self._open.get(key, 0) >= self.limit:
            return False
        self._open[key] = self._open.get(key, 0) + 1
        return True

    def give(self, key: str) -> None:
        left = self._open.get(key, 0) - 1
        if left > 0:
            self._open[key] = left
        else:
            self._open.pop(key, None)
