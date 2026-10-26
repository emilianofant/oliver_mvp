#!/usr/bin/env bash
# POST /api/trim-highlight — curl the trim endpoint; prints { clipUrl }
set -euo pipefail

SOURCE="${1:?usage: scripts/trim-highlight.sh <source.mp4> [start] [duration]}"
START="${2:-5}"
DURATION="${3:-3}"
BASE_URL="http://localhost:3001"

curl -sS -X POST "$BASE_URL/api/trim-highlight" \
  -H "Content-Type: application/json" \
  -d "{\"source\":\"$SOURCE\",\"start\":$START,\"duration\":$DURATION}"
echo
