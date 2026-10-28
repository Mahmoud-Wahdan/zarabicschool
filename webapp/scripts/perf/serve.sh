#!/usr/bin/env sh
# Start the app for a measurement (L1): scripts/perf/serve.sh <dev|start> <query-log-file>
# Port 3000 (the port the owner's ngrok tunnel forwards to). The worker is off and,
# for a production start, OpenWA points at a closed local port, so a measurement can
# never send a WhatsApp message. .env is not changed.
mode="$1"; log="$2"
export PERF_NO_WORKER=1 PERF_QUERY_LOG="$log"
export NODE_OPTIONS="--require $(pwd -W 2>/dev/null || pwd)/scripts/perf/preload.cjs"
if [ "$mode" = "start" ]; then export OPENWA_URL="http://127.0.0.1:9"; fi
exec node node_modules/next/dist/bin/next "$mode" -p 3000
