#!/usr/bin/env bash
# Variant C: parallel worktree fan-out.
#   stage 1 (serial):   foundation agent — scaffold + model + store + skeletal server
#   stage 2 (parallel): server / tests / main workers in separate git worktrees
#   stage 3 (serial):   merge agent — merges branches, fixes until green
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
common="$root/experiments/common"
res="$root/experiments/results/c"
STAGE_TIMEOUT="${STAGE_TIMEOUT:-900}"
MERGE_TIMEOUT="${MERGE_TIMEOUT:-1200}"

mkdir -p "$res"
ws="$("$common/seed-workspace.sh" c)"
wsdir="$(dirname "$ws")"

total_start=$(date +%s)

# --- stage 1: foundation -----------------------------------------------------
echo "=== C foundation start $(date -u +%FT%TZ) ==="
s1=$(date +%s)
"$common/run-claude.sh" "$ws" "$here/prompts/foundation.md" "foundation" "$res" "$STAGE_TIMEOUT"
git -C "$ws" add -A && git -C "$ws" commit -q -m "foundation"
foundation_s=$(( $(date +%s) - s1 ))

# --- stage 2: fan-out --------------------------------------------------------
echo "=== C fan-out start $(date -u +%FT%TZ) ==="
s2=$(date +%s)
declare -a pids=()
for w in server tests main; do
  wt="$wsdir/c-wt-$w"
  rm -rf "$wt"
  git -C "$ws" worktree add -q -b "wt-$w" "$wt"
  "$common/run-claude.sh" "$wt" "$here/prompts/$w.md" "worker-$w" "$res" "$STAGE_TIMEOUT" &
  pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid"; done

for w in server tests main; do
  wt="$wsdir/c-wt-$w"
  git -C "$wt" add -A && git -C "$wt" commit -q --allow-empty -m "worker: $w"
  git -C "$ws" worktree remove --force "$wt"
done
fanout_s=$(( $(date +%s) - s2 ))

# --- stage 3: merge ----------------------------------------------------------
echo "=== C merge start $(date -u +%FT%TZ) ==="
s3=$(date +%s)
"$common/run-claude.sh" "$ws" "$here/prompts/merge.md" "merge" "$res" "$MERGE_TIMEOUT"
git -C "$ws" add -A && git -C "$ws" commit -q --allow-empty -m "post-merge cleanup"
merge_s=$(( $(date +%s) - s3 ))

echo $(( $(date +%s) - total_start )) > "$res/wall_clock_total_s"
printf '{"foundation_s": %d, "fanout_s": %d, "merge_s": %d}\n' \
  "$foundation_s" "$fanout_s" "$merge_s" > "$res/stages.json"

if ! grep -q '^- \[ \]' "$ws/SPEC.md" \
   && [ -d "$ws/app" ] && (cd "$ws/app" && mvn -q test >/dev/null 2>&1); then
  echo done > "$res/final_status"
  echo "=== C DONE ==="
else
  echo incomplete > "$res/final_status"
  echo "=== C INCOMPLETE ==="
  exit 1
fi
