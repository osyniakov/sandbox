#!/usr/bin/env bash
# Variant A: sequential Ralph-style loop, instrumented.
# Completion is derived from verifiable state only: zero unticked SPEC boxes
# AND `mvn -q test` green (no self-reported sentinel).
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
common="$root/experiments/common"
res="$root/experiments/results/a"
MAX_ITER="${MAX_ITER:-8}"
ITER_TIMEOUT="${ITER_TIMEOUT:-900}"

mkdir -p "$res"
ws="$("$common/seed-workspace.sh" a)"

cat > "$ws/PROGRESS.md" <<'EOF'
# PROGRESS

Memory shared between iterations of the development loop. Each iteration rewrites
the sections below and appends one line to the iteration log.

## Current state

Nothing built yet. `app/` does not exist.

## Next step

Scaffold the Maven project — the first checklist item in `SPEC.md`.

## Gotchas

(none yet)

## Iteration log
EOF
git -C "$ws" add -A && git -C "$ws" commit -q -m "seed: PROGRESS"

done_check() {
  ! grep -q '^- \[ \]' "$ws/SPEC.md" \
    && [ -d "$ws/app" ] && (cd "$ws/app" && mvn -q test >/dev/null 2>&1)
}

total_start=$(date +%s)
status=incomplete
for ((i = 1; i <= MAX_ITER; i++)); do
  echo "=== A iter $i/$MAX_ITER start $(date -u +%FT%TZ) ==="
  "$common/run-claude.sh" "$ws" "$here/PROMPT.md" "iter-$i" "$res" "$ITER_TIMEOUT"
  git -C "$ws" add -A && git -C "$ws" commit -q --allow-empty -m "iteration $i"
  if done_check; then
    status=done
    echo "=== A DONE after $i iterations ==="
    break
  fi
done

echo $(( $(date +%s) - total_start )) > "$res/wall_clock_total_s"
echo "$status" > "$res/final_status"
[ "$status" = done ]
