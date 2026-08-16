#!/usr/bin/env bash
# Low-memory wrappers for this machine (16 GB RAM, 24 logical cores).
#
# The defaults in this monorepo are sized for CI, not a laptop:
#   - `npx jest` with no flags uses cores-1 = 23 workers, each a node process
#   - tsgo/tsc on twenty-server routinely wants several GB
# Run two or three of those concurrently and the host is OOM-killed. That is
# what kept killing the Claude Code process during the phase workflows.
#
# Usage, from packages/twenty-server:
#   bash ../../scripts/lowmem.sh test <jest-pattern>
#   bash ../../scripts/lowmem.sh itest <jest-pattern>
#   bash ../../scripts/lowmem.sh types
#   bash ../../scripts/lowmem.sh full          # full unit suite, serialised

set -euo pipefail

# Cap the heap so a runaway typecheck dies with a clear error instead of
# swapping the whole machine to a standstill.
export NODE_OPTIONS="--max-old-space-size=3072"

cmd="${1:-}"
shift || true

case "$cmd" in
  test)
    exec npx jest --maxWorkers=2 --workerIdleMemoryLimit=1G "$@"
    ;;
  itest)
    # Integration tests hit one shared database; parallel workers corrupt
    # each other's fixtures as well as exhausting RAM.
    exec npx jest --config ./jest-integration.config.ts --runInBand "$@"
    ;;
  types)
    exec npx tsgo -p tsconfig.json --noEmit
    ;;
  full)
    exec npx jest --maxWorkers=2 --workerIdleMemoryLimit=1G
    ;;
  *)
    echo "usage: lowmem.sh {test|itest|types|full} [pattern]" >&2
    exit 2
    ;;
esac
