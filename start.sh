#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
  echo ""
  echo "Shutting down..."
  kill 0 2>/dev/null
  wait 2>/dev/null
  echo "Done."
}
trap cleanup EXIT INT TERM

# Backend
echo "Starting backend (uvicorn on :8000)..."
cd "$ROOT/backend"
uvicorn main:app --reload --host 0.0.0.0 --port 8000 &

# Frontend
echo "Starting frontend (vite dev)..."
cd "$ROOT/frontend"
pnpm dev &

wait
