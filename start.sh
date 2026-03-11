#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID=""
FRONTEND_PID=""
SHUTTING_DOWN=false

cleanup() {
  $SHUTTING_DOWN && return
  SHUTTING_DOWN=true
  echo ""
  echo "Shutting down..."
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
  wait 2>/dev/null
  echo "Done."
}
trap cleanup INT TERM
trap 'cleanup; exit 0' EXIT

# Activate conda env
eval "$(conda shell.bash hook)"
conda activate colloquia

# Backend
echo "Starting backend (uvicorn on :8000)..."
cd "$ROOT/backend"
uvicorn main:app --reload --host 0.0.0.0 --port 8000 2>&1 &
BACKEND_PID=$!

# Frontend
echo "Starting frontend (vite dev)..."
cd "$ROOT/frontend"
pnpm dev 2>&1 &
FRONTEND_PID=$!

# Wait in a loop so signals are handled promptly
while kill -0 "$BACKEND_PID" 2>/dev/null || kill -0 "$FRONTEND_PID" 2>/dev/null; do
  wait -n 2>/dev/null || true
done
