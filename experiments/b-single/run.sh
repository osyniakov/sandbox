#!/usr/bin/env bash
# Variant B: one continuous headless session implements the whole spec.
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
common="$root/experiments/common"
res="$root/experiments/results/b"
SESSION_TIMEOUT="${SESSION_TIMEOUT:-2400}"

mkdir -p "$res"
ws="$("$common/seed-workspace.sh" b)"

total_start=$(date +%s)
echo "=== B session start $(date -u +%FT%TZ) ==="
"$common/run-claude.sh" "$ws" "$here/PROMPT.md" "session" "$res" "$SESSION_TIMEOUT"
git -C "$ws" add -A && git -C "$ws" commit -q --allow-empty -m "single session result"

echo $(( $(date +%s) - total_start )) > "$res/wall_clock_total_s"

if ! grep -q '^- \[ \]' "$ws/SPEC.md" \
   && [ -d "$ws/app" ] && (cd "$ws/app" && mvn -q test >/dev/null 2>&1); then
  echo done > "$res/final_status"
  echo "=== B DONE ==="
else
  echo incomplete > "$res/final_status"
  echo "=== B INCOMPLETE ==="
  exit 1
fi
