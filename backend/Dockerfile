FROM python:3.14-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Optional page-link resolver (RESOLVER_ENABLED=true in .env builds with it). yt-dlp must stay current, so it is not pinned:
# rebuild with --no-cache now and then.
ARG WITH_RESOLVER=false
RUN if [ "$WITH_RESOLVER" = "true" ]; then pip install --no-cache-dir yt-dlp; fi

COPY main.py .
COPY app ./app

EXPOSE 8000
# One worker: rooms live in this process's memory. A single worker handles thousands of rooms.
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
