#!/usr/bin/env bash
# POST /api/upload — curl the MP4 upload endpoint; prints { id, videoUrl, analysis }
set -euo pipefail

FILE="${1:-samples/00_padel.mp4}"
BASE_URL="http://localhost:3001"

curl -sS -X POST "$BASE_URL/api/upload" -F "video=@$FILE"
echo
