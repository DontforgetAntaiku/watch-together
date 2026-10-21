<div align="center">

# Watch Together

**Press play, together.**

Open a page, get a short room code, share it. Everyone's browser plays the video by itself,
and the server only passes tiny play, pause and seek messages.

Free · Open source · No account · No install · Nothing streamed through the server · Mobile friendly

<img src="docs/room-light.png" alt="Watch Together — a room, light theme" width="780">

</div>

---

## How it works

1. **Create a room.** One click gives you a 6-character code (`K7M2QX`) and an invite link.
2. **Everyone opens their own video.** Paste a link (`.mp4`, `.webm`, `.m3u8` HLS…) or open a file from your own disk.
   Each person picks their own source and quality; you can even mix a link and a file.
3. **Press play.** Play, pause and seek are shared. Late joiners catch up on their own.

The video **never touches the server**. The server keeps one tiny state per room
(`playing`, `position`, `time it was valid`) and forwards changes, so a single small VPS can host thousands of rooms.

<div align="center">
<img src="docs/home-dark.png" alt="Home page, dark theme" width="520">
&nbsp;
<img src="docs/room-mobile-dark.png" alt="Room on a phone, dark theme" width="210">
&nbsp;
<img src="docs/home-mobile-light.png" alt="Home on a phone, light theme" width="210">
</div>

## Features

- **Rooms without accounts** — short code or invite link; rooms live in memory and disappear 30 minutes after the last person leaves.
- **Links and local files** — direct video links, **HLS** (`.m3u8`, via [hls.js](https://github.com/video-dev/hls.js), loaded only when needed; Safari and recent Chrome play HLS natively) and files picked from disk (stay on the device).
- **Tight sync** — all clocks are aligned to the server; tiny drift is smoothed with a ±5 % speed nudge, big drift is fixed with a seek. Typical error is well under 100 ms on a good connection.
- **Late join** — a person who joins while the video plays lands on the right second.
- **Offer a link** — optionally share your link with the room; others get a one-click "Use it" button.
- **Phone-first layout** — pinned player while you scroll, big touch targets, safe-area aware, landscape mode that fits the screen,
  the system **Share** sheet for invites, and a source panel that tucks away once a video is loaded.
- **Light and dark theme** — follows the system.
- **Private by design** — no analytics, no cookies, no third-party requests, no CDN fonts. The server never sees your file or watches your screen.
- **Tiny backend** — FastAPI, one process, no database, no Redis.

## Which links work

The browser itself downloads the video, so the host has to allow it:

| Source | Works when |
|---|---|
| Direct file (`.mp4`, `.webm`) | The host allows playback from other sites (most do). |
| HLS (`.m3u8`) | Safari / recent Chrome: usually yes. Other browsers need the host to send CORS headers (`Access-Control-Allow-Origin`). |
| Local file | Always. Everyone should open the **same cut**, or positions will not match. |

Things that commonly break a link: it **expired** (many CDN links carry a time-limited token), it is **bound to the IP** of whoever copied it,
the host blocks other websites, or the page is `https` and the link is plain `http` (the browser refuses mixed content).
The app tells you which kind of failure it saw. If a link does not work for a friend, send the file instead.

> Only use videos you are allowed to watch and share. This tool does not download, store or re-stream anything.

## Quick start

Requirements: Node.js 24 (LTS), Python 3.13+ and [uv](https://docs.astral.sh/uv/).

```bash
git clone git@github.com:DontforgetAntaiku/watch-together.git
cd watch-together
cp .env.example .env
```

Backend (port 8000):

```bash
cd backend
uv sync
uv run python -m uvicorn main:app --port 8000 --reload
```

Frontend (port 5173, proxies `/api` to the backend):

```bash
cd frontend
npm ci
npm run dev
```

Open <http://localhost:5173>, create a room, then open the invite link in a second browser window.

### Run the tests

```bash
cd backend && uv run python -m pytest -q     # room logic and HTTP API
cd frontend && npm run lint && npm run build  # lint + type-check + production build
```

## Docker

```bash
cp .env.example .env
docker compose up -d --build backend              # API on 127.0.0.1:${BACKEND_PORT}
docker compose run --rm frontend-builder          # static site into ./deploy
```

| Variable | Default | Meaning |
|---|---|---|
| `BACKEND_PORT` | `8000` | Host port the backend is published on (`127.0.0.1` only) |
| `BACKEND_DEBUG` | `True` | `False` disables `/docs`, `/redoc` and `/openapi.json` |
| `FRONTEND_DEBUG` | `True` | `False` builds the frontend for production |
| `FRONTEND_BUILD_OUTPUT` | `./deploy` | Host folder that receives the built site |
| `ALLOWED_ORIGINS` | *(empty)* | Comma-separated site origins allowed to call the API. **Set it in production**, e.g. `https://watch.example.com` |
| `MAX_ROOMS` | `5000` | Rooms alive at once |
| `MAX_MEMBERS` | `30` | People per room |
| `EMPTY_ROOM_TTL` | `1800` | Seconds an empty room is kept |
| `CREATE_PER_MINUTE` | `20` | Room creations per IP per minute |
| `HOST_UID` / `HOST_GID` | `1000` | Owner of the generated files |

## Deployment

The frontend is a static site; the backend is one container on `127.0.0.1`. Put any reverse proxy with HTTPS in front:

- Serve the static folder and fall back to `/index.html` for unknown paths (rooms live at `/r/CODE`).
- Proxy `/api/` to `http://127.0.0.1:${BACKEND_PORT}/api/` and pass `X-Real-IP` (used for rate limits).
- **Run a single backend worker**: rooms are kept in the memory of that process.
- No WebSocket configuration is needed: live updates use plain **Server-Sent Events**, so any HTTP proxy works.
  Keep response buffering off for the events route (the backend already sends `X-Accel-Buffering: no`).

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8000/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

A restart of the backend empties all rooms; clients see "This room does not exist" and can simply create a new one.

## Protocol

Everything is under `/api`:

| Method and path | Purpose |
|---|---|
| `POST /rooms` | Create a room → `{ "code": "K7M2QX" }` (rate limited per IP) |
| `GET /rooms/{code}` | Does it exist, how many people are in it |
| `GET /rooms/{code}/events` | **SSE** stream: `hello` (your id and token), then a full `state` on every change |
| `POST /rooms/{code}/msg` | `play` / `pause` / `seek` with `pos`, `ts`, or `source` with `url` |
| `GET /time` | Server clock, used to align every client |
| `GET /health` | Liveness |

The room state is one snapshot, so it is idempotent and a slow client simply gets the newest one:

```json
{ "t": "state", "playing": true, "pos": 42.5, "at": 1792593246650, "rev": 7, "by": "e9e027b8b0e0", "n": 3, "source": null }
```

A client computes where the shared playhead is *now* as `pos + (serverNow − at) / 1000` while playing, and `pos` while paused.
The sender stamps its position with its own server-time estimate, which cancels its network delay.

**Staying in sync without echo loops.** A player only announces a local action when it *differs* from what the room already
believes, so a player that merely obeyed the room never speaks. Drift is checked once a second: gap above 1.2 s → seek,
above 0.15 s → playback speed 0.95 or 1.05, otherwise 1.0.

**Abuse limits.** Strict message validation (no unknown fields, finite bounded numbers, `http(s)` links only), a token bucket per
connection, a cap on rooms and people per room, per-IP room creation limit, origin check, per-member secret token on every message.
There is no personal data: no accounts, no stored IPs beyond a short in-memory rate-limit window.

## Project structure

```
backend/
├── main.py                  app factory, docs switched off when BACKEND_DEBUG=False
├── app/
│   ├── settings.py          environment settings
│   ├── rooms.py             room state, validation, rate limit, broadcast (no I/O)
│   └── routers/rooms.py     HTTP + SSE endpoints
├── tests/                   pytest: room logic and API
└── Dockerfile               python:3.14-slim
frontend/
├── src/
│   ├── components/          Home, Room, Player, SourcePanel, RoomCode, Logo, Footer (each: Name/Name.tsx + Name.css)
│   ├── lib/useRoom.ts       SSE connection and message sending
│   ├── lib/clock.ts         server clock estimate and playhead maths
│   ├── lib/attach.ts        links → <video>, hls.js on demand, friendly errors
│   └── index.css            design tokens (light/dark) and shared controls
└── Dockerfile               node:24-alpine build, copy-only final stage
docker-compose.yml           backend + frontend-builder
docs/                        screenshots used in this README
```

**Stack:** Vite · React 19 · TypeScript · Tailwind CSS v4 · hls.js · FastAPI · uvicorn.

## Limits and ideas

- Playback speed is not synced (the speed is used internally to nudge small drifts).
- If someone's video buffers for a long time, the others keep playing; that person catches up with a seek.
- No chat, no accounts, no subtitles sync yet. Pull requests are welcome.

## Contributing

Issues and pull requests are welcome. Please run `uv run python -m pytest` in `backend/` and `npm run lint && npm run build`
in `frontend/` before opening a PR.

## License

[MIT](LICENSE) © 2026 DontforgetAntaiku

## Credits

Built by [DontforgetAntaiku](https://dontforgetantaiku.dev/).
