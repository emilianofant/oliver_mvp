#!/usr/bin/env bash
# Remove generated data (uploads, clips, analysis) for a clean test run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT/data"

for sub in uploads clips analysis; do
  rm -rf "$DATA_DIR/$sub"
done
mkdir -p "$DATA_DIR/uploads" "$DATA_DIR/clips" "$DATA_DIR/analysis"

echo "cleaned $DATA_DIR/{uploads,clips,analysis}"
