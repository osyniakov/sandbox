#!/usr/bin/env bash
# Ralph-style autonomous development loop.
#
# Each iteration feeds PROMPT.md to a fresh headless Claude Code session, then
# commits whatever changed. The loop stops when PROGRESS.md contains the
# ALL_SPEC_ITEMS_COMPLETE sentinel AND `mvn -q test` is green in app/, or when
# MAX_ITER is reached.
#
# Usage: loop/run-loop.sh [max-iterations]   (default 8)
#   ITER_TIMEOUT   seconds per iteration before it is killed (default 900)

set -uo pipefail

cd "$(git rev-parse --show-toplevel)"

MAX_ITER="${1:-8}"
ITER_TIMEOUT="${ITER_TIMEOUT:-900}"
mkdir -p loop/logs

# claude refuses --dangerously-skip-permissions as root unless it knows it is
# inside a disposable sandbox; this container is one.
export IS_SANDBOX=1

# Exact whole-line match: prose in PROGRESS.md that merely *mentions* the
# sentinel (e.g. "remember to append ALL_SPEC_ITEMS_COMPLETE") must not stop
# the loop — that false positive actually happened in iteration 2.
sentinel_present() { grep -qxF "ALL_SPEC_ITEMS_COMPLETE" PROGRESS.md 2>/dev/null; }
tests_green()      { [ -d app ] && (cd app && mvn -q test >/dev/null 2>&1); }

for ((i = 1; i <= MAX_ITER; i++)); do
  log="loop/logs/iter-$i.log"
  echo "=== iteration $i/$MAX_ITER start $(date -u +%FT%TZ) ==="

  if ! timeout "$ITER_TIMEOUT" claude -p "$(cat PROMPT.md)" \
        --dangerously-skip-permissions >"$log" 2>&1; then
    echo "iteration $i: claude exited non-zero or hit the ${ITER_TIMEOUT}s timeout (see $log)"
  fi

  git add -A
  git commit --allow-empty -q -m "loop: iteration $i"
  echo "=== iteration $i end   $(date -u +%FT%TZ) ==="

  if sentinel_present && tests_green; then
    echo "DONE after iteration $i: sentinel present and tests green."
    exit 0
  fi
done

echo "STOPPED: reached MAX_ITER=$MAX_ITER without completion."
sentinel_present && echo "sentinel: present" || echo "sentinel: absent"
tests_green      && echo "tests: green"     || echo "tests: failing or absent"
exit 1
