#!/usr/bin/env bash
# Instrumented headless Claude Code invocation.
# Usage: run-claude.sh <workdir> <prompt-file> <label> <results-dir> [timeout-seconds]
#
# Writes to <results-dir>:
#   <label>.jsonl         full stream-json transcript
#   <label>.stderr        stderr of the claude process
#   <label>.metrics.json  tokens / cost / turns / wall-clock extracted from the
#                         terminal "result" event
set -uo pipefail

workdir="$1"; promptfile="$2"; label="$3"; resdir="$4"; tmo="${5:-900}"
mkdir -p "$resdir"

export IS_SANDBOX=1

start_epoch=$(date +%s)
start_iso=$(date -u +%FT%TZ)

(
  cd "$workdir" &&
  timeout "$tmo" claude -p "$(cat "$promptfile")" \
    --dangerously-skip-permissions \
    --output-format stream-json --verbose \
    > "$resdir/$label.jsonl" 2> "$resdir/$label.stderr"
)
rc=$?
end_epoch=$(date +%s)

python3 - "$resdir/$label.jsonl" "$resdir/$label.metrics.json" "$label" \
  "$((end_epoch - start_epoch))" "$rc" "$start_iso" <<'PY'
import json, sys

jsonl, out, label, wall, rc, start_iso = sys.argv[1:7]
result = None
try:
    for line in open(jsonl, encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if ev.get("type") == "result":
            result = ev
except FileNotFoundError:
    pass

m = {"label": label, "wall_clock_s": int(wall), "exit_code": int(rc),
     "started_at": start_iso}
if result:
    u = result.get("usage") or {}
    m.update({
        "num_turns": result.get("num_turns"),
        "duration_ms": result.get("duration_ms"),
        "duration_api_ms": result.get("duration_api_ms"),
        "total_cost_usd": result.get("total_cost_usd"),
        "input_tokens": u.get("input_tokens"),
        "output_tokens": u.get("output_tokens"),
        "cache_creation_input_tokens": u.get("cache_creation_input_tokens"),
        "cache_read_input_tokens": u.get("cache_read_input_tokens"),
        "is_error": result.get("is_error"),
        "subtype": result.get("subtype"),
    })
else:
    m["error"] = "no result event in transcript (timeout or crash)"

with open(out, "w") as f:
    json.dump(m, f, indent=2)
print(f"[metrics] {label}: wall={wall}s rc={rc} "
      f"turns={m.get('num_turns')} cost=${m.get('total_cost_usd')}")
PY

exit "$rc"
