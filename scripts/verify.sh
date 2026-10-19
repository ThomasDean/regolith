#!/usr/bin/env bash
# Full before/after verification for the CPU rework. Usage: scripts/verify.sh <outdir> [games]
# Runs habit profiles for every level (old and new) and seat-rotated tournaments.
set -u
out=${1:?outdir}; n=${2:-30}
mkdir -p "$out"
cd "$(dirname "$0")/.."
run() { echo "== $1"; npx tsx scripts/$2 > "$out/$1.txt" 2>&1; cat "$out/$1.txt" | tail -3; }
run batch-levels "batch.ts easy,normal,hard 1 $n"
run batch-normal-vs-old "batch.ts normal,old-normal,old-normal 1 $n"
run batch-old-vs-normal "batch.ts old-normal,normal,normal 1 $n"
run batch-hard-vs-old "batch.ts hard,old-hard,old-hard 1 $n"
run batch-old-vs-hard "batch.ts old-hard,hard,hard 1 $n"
run habits-easy "habits.ts easy,easy,easy 1 $n"
run habits-normal "habits.ts normal,normal,normal 1 $n"
run habits-hard "habits.ts hard,hard,hard 1 $n"
echo ALLDONE
