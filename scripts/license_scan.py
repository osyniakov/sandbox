#!/usr/bin/env python3
"""Third-party license scan (modelled on Quickwit's LICENSE-3rdparty.csv).

Usage (from the repo root, inside a venv created with the pinned versions:

    pip install -r backend/requirements.txt -c backend/constraints.txt pip-licenses

pip-licenses is a dev tool and is NOT a runtime requirement):

    python scripts/license_scan.py generate --python   # rewrite LICENSE-3rdparty.csv
    python scripts/license_scan.py check --python      # exit 1 on problems

`check` fails when (a) a component's license is not in "allowed" in
license-config.json and the component is not in "reviewed", or (b) the
committed LICENSE-3rdparty.csv differs from what `generate` would produce.

Adding a reviewed exception: after actually reviewing the license, add an
entry to the "reviewed" object in license-config.json mapping the exact
component name to the license string it was reviewed under plus a reason, e.g.

    "reviewed": {"somepkg": {"license": "LGPL-3.0", "reason": "dynamic use only"}}

The check fails if the installed license later differs from the stored one.

then re-run `generate` and commit both files. To allow a whole license, add it
to "allowed" instead. License matching is case-insensitive, and an
"A OR B" expression passes if any alternative is allowed.
"""

import argparse
import csv
import io
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "license-config.json"
CSV_PATH = ROOT / "LICENSE-3rdparty.csv"
COLUMNS = ["Component", "Origin", "License", "Copyright"]
# The project itself, plus tooling that lives in the scan venv but is not a dependency.
EXCLUDED = {
    "backend",
    "app",
    "pip",
    "setuptools",
    "wheel",
    "pip-licenses",
    "prettytable",
    "wcwidth",
}


def is_allowed(license_str, allowed):
    """True if license_str (or any ' OR ' alternative) is in allowed, case-insensitively."""
    allowed_lc = {a.strip().lower() for a in allowed}
    alternatives = [p.strip().lower() for p in license_str.split(" OR ")]
    return any(alt in allowed_lc for alt in alternatives)


def violations(rows, config):
    """Return rows whose license is neither allowed nor reviewed."""
    reviewed = config.get("reviewed", {})
    allowed = config.get("allowed", [])
    bad = []
    for r in rows:
        entry = reviewed.get(r["Component"])
        if entry is not None:
            if entry.get("license") != r["License"]:
                bad.append(r)
        elif not is_allowed(r["License"], allowed):
            bad.append(r)
    return bad


def rows_from_pip_licenses(data):
    """Convert pip-licenses JSON (parsed) into sorted CSV row dicts."""
    rows = []
    for pkg in data:
        name = pkg["Name"]
        if name.lower() in EXCLUDED:
            continue
        author = pkg.get("Author") or ""
        if author.strip().upper() == "UNKNOWN":
            author = ""
        rows.append(
            {
                "Component": name,
                "Origin": pkg.get("Version", ""),
                "License": pkg.get("License") or "UNKNOWN",
                "Copyright": author,
            }
        )
    rows.sort(key=lambda r: (r["Component"].lower(), r["Component"]))
    return rows


def render_csv(rows):
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue()


def check_csv(rows, committed_text, config):
    """Return a list of problem strings (empty when everything is fine)."""
    problems = [
        f"license not allowed: {r['Component']} {r['Origin']} ({r['License']})"
        for r in violations(rows, config)
    ]
    if committed_text != render_csv(rows):
        problems.append(
            "LICENSE-3rdparty.csv is stale; run: python scripts/license_scan.py generate --python"
        )
    return problems


def run_pip_licenses():
    exe = shutil.which("pip-licenses")
    cmd = [exe] if exe else [sys.executable, "-m", "piplicenses"]
    cmd += ["--format=json", "--with-urls", "--with-authors"]
    out = subprocess.run(cmd, check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["generate", "check"])
    parser.add_argument("--python", action="store_true", required=True)
    args = parser.parse_args(argv)

    config = json.loads(CONFIG_PATH.read_text())
    rows = rows_from_pip_licenses(run_pip_licenses())

    if args.command == "generate":
        CSV_PATH.write_text(render_csv(rows), newline="")
        print(f"wrote {CSV_PATH} ({len(rows)} components)")
        return 0

    committed = CSV_PATH.read_text() if CSV_PATH.exists() else ""
    problems = check_csv(rows, committed, config)
    for p in problems:
        print(p, file=sys.stderr)
    if not problems:
        print(f"license check OK ({len(rows)} components)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
