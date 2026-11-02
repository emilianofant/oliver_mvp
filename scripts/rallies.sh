#!/usr/bin/env bash
# GET /api/rallies — curl the rallies endpoint (filters/sort/pagination); prints { items, total, page, perPage }
set -euo pipefail

BASE_URL="http://localhost:3001"
MIN_DURATION_S="${1:-}"        # e.g. 8 → only rallies with duration_s >= 8
ORDER_BY="${2:-start}"         # start|intensity|duration
ORDER="${3:-asc}"              # asc|desc
PAGE="${4:-1}"
PER_PAGE="${5:-20}"            # 1..100

QS="page=$PAGE&per_page=$PER_PAGE&order_by=$ORDER_BY&order=$ORDER"
if [ -n "$MIN_DURATION_S" ]; then
  QS="$QS&min_duration_s=$MIN_DURATION_S"
fi

curl -sS "$BASE_URL/api/rallies?$QS"
echo
