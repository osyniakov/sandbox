#!/usr/bin/env python3
"""Aggregate per-agent metrics from experiments/results/ into a markdown table."""
import json
import sys
from pathlib import Path

RESULTS = Path(__file__).parent / "results"
VARIANTS = {
    "a": "A — sequential loop",
    "b": "B — single session",
    "c": "C — parallel fan-out",
}


def load(variant: str) -> dict:
    d = RESULTS / variant
    sessions = []
    for f in sorted(d.glob("*.metrics.json")):
        sessions.append(json.loads(f.read_text()))
    total = {
        "sessions": len(sessions),
        "turns": sum(s.get("num_turns") or 0 for s in sessions),
        "input_tokens": sum(s.get("input_tokens") or 0 for s in sessions),
        "output_tokens": sum(s.get("output_tokens") or 0 for s in sessions),
        "cache_creation": sum(s.get("cache_creation_input_tokens") or 0 for s in sessions),
        "cache_read": sum(s.get("cache_read_input_tokens") or 0 for s in sessions),
        "cost_usd": sum(s.get("total_cost_usd") or 0 for s in sessions),
        "agent_s": sum((s.get("duration_ms") or 0) / 1000 for s in sessions),
        "errors": [s["label"] for s in sessions if s.get("is_error") or s.get("error")],
        "per_session": sessions,
    }
    wall = d / "wall_clock_total_s"
    total["wall_clock_s"] = int(wall.read_text().strip()) if wall.exists() else None
    status = d / "final_status"
    total["final_status"] = status.read_text().strip() if status.exists() else "unknown"
    stages = d / "stages.json"
    if stages.exists():
        total["stages"] = json.loads(stages.read_text())
    return total


def fmt_k(n):
    return f"{n/1000:.1f}k" if n else "0"


def main():
    data = {v: load(v) for v in VARIANTS if (RESULTS / v).is_dir()}

    print("| Metric | " + " | ".join(VARIANTS[v] for v in data) + " |")
    print("|---|" + "---|" * len(data))
    rows = [
        ("Outcome", lambda t: t["final_status"]),
        ("Wall-clock", lambda t: f"{t['wall_clock_s']//60}m {t['wall_clock_s']%60:02d}s"
            if t["wall_clock_s"] is not None else "?"),
        ("Agent sessions", lambda t: str(t["sessions"])),
        ("Total turns", lambda t: str(t["turns"])),
        ("Agent time (sum)", lambda t: f"{t['agent_s']/60:.1f}m"),
        ("Output tokens", lambda t: fmt_k(t["output_tokens"])),
        ("Input tokens (uncached)", lambda t: fmt_k(t["input_tokens"])),
        ("Cache-creation tokens", lambda t: fmt_k(t["cache_creation"])),
        ("Cache-read tokens", lambda t: fmt_k(t["cache_read"])),
        ("Cost (USD)", lambda t: f"${t['cost_usd']:.2f}"),
        ("Session errors", lambda t: ", ".join(t["errors"]) or "none"),
    ]
    for name, fn in rows:
        print(f"| {name} | " + " | ".join(fn(data[v]) for v in data) + " |")

    for v, t in data.items():
        if "stages" in t:
            s = t["stages"]
            print(f"\nVariant {v.upper()} stage wall-clock: "
                  f"foundation {s['foundation_s']}s, "
                  f"fan-out {s['fanout_s']}s (3 workers in parallel), "
                  f"merge {s['merge_s']}s")

    print("\nPer-session detail:")
    for v, t in data.items():
        for s in t["per_session"]:
            print(f"  {v}/{s['label']}: wall={s.get('wall_clock_s')}s "
                  f"turns={s.get('num_turns')} "
                  f"out={fmt_k(s.get('output_tokens') or 0)} "
                  f"cost=${(s.get('total_cost_usd') or 0):.2f} "
                  f"{'ERROR: ' + str(s.get('error') or s.get('subtype')) if (s.get('is_error') or s.get('error')) else ''}")


if __name__ == "__main__":
    sys.exit(main())
