FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Bookworm's system Python is PEP 668 externally-managed, so install into a venv on PATH.
COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

ENV PATH="/opt/venv/bin:$PATH"
# server.js spawns the interpreter via PYTHON_BIN (falls back to ./.venv/bin/python).
ENV PYTHON_BIN=python

COPY server ./server
RUN cd server && npm ci

COPY python ./python

# Runtime workdir = server/ so `docker compose exec server npm run ...` finds package.json.
# App code resolves every path via __dirname, and spawned children set cwd explicitly, so the
# app is insensitive to this; CMD names the file directly instead of relying on /app.
WORKDIR /app/server
CMD ["node", "server.js"]
