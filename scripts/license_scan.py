#!/usr/bin/env python3
"""Third-party license scan (modelled on Quickwit's LICENSE-3rdparty.csv).

Usage (from the repo root, inside a venv created with the pinned versions:

    pip install -r backend/requirements.txt -c backend/constraints.txt pip-licenses

pip-licenses is a dev tool and is NOT a runtime requirement):

    python scripts/license_scan.py generate [--python] [--npm]   # rewrite LICENSE-3rdparty.csv
    python scripts/license_scan.py check [--python] [--npm]      # exit 1 on problems

With no platform flag both ecosystems are scanned. The npm scan runs
license-checker-rseidelsohn (a frontend devDependency, run from frontend/ after
`npm ci`) with --production, so dev tooling is not listed. Python and npm rows
share one CSV, sorted case-insensitively by Component. A single-platform
`generate` only replaces rows with the scanned component names (use a full
`generate` to drop removed components); a single-platform `check` verifies
licenses and that the scanned rows appear verbatim in the committed CSV.

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
FRONTEND = ROOT / "frontend"
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


def _npm_license(value):
    """Normalise license-checker's `licenses` (string, list, or missing) to one string."""
    if isinstance(value, (list, tuple)):
        parts = [str(v).strip() for v in value if str(v).strip()]
        value = "; ".join(parts)  # same joiner as pip-licenses: not allowed unless reviewed
    value = (value or "").strip()
    if value.startswith("(") and value.endswith(")") and value.count("(") == 1:
        value = value[1:-1].strip()  # SPDX "(MIT OR Apache-2.0)"
    return value or "UNKNOWN"


def rows_from_npm_licenses(data):
    """Convert license-checker JSON (parsed; keys are 'name@version') into row dicts.

    The root project (private) is skipped. Scoped names keep their '@scope/'.
    """
    rows = []
    for key, pkg in data.items():
        if pkg.get("private"):
            continue
        name, sep, version = key.rpartition("@")
        if not sep or not name:  # no version part, e.g. "name"
            name, version = key, ""
        publisher = (pkg.get("publisher") or "").strip()
        if publisher.upper() == "UNKNOWN":
            publisher = ""
        rows.append(
            {
                "Component": name,
                "Origin": version,
                "License": _npm_license(pkg.get("licenses")),
                "Copyright": publisher,
            }
        )
    rows.sort(key=lambda r: (r["Component"].lower(), r["Component"]))
    return rows


def merge_rows(*groups):
    """Combine row groups into one list sorted case-insensitively by Component.

    The sort is stable, so on a name collision the earlier group's row comes first.
    """
    rows = [r for g in groups for r in g]
    rows.sort(key=lambda r: (r["Component"].lower(), r["Component"]))
    return rows


def collisions(python_rows, npm_rows):
    """Component names (case-insensitive) present in both ecosystems."""
    return sorted({r["Component"].lower() for r in python_rows} & {r["Component"].lower() for r in npm_rows})


def render_csv(rows):
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue()


def check_csv(rows, committed_text, config, partial=False, regen_cmd="generate"):
    """Return a list of problem strings (empty when everything is fine).

    With partial=True (single-platform check) rows only need to appear in the
    committed CSV; otherwise the committed text must equal the rendering exactly.
    """
    problems = [
        f"license not allowed: {r['Component']} {r['Origin']} ({r['License']})"
        for r in violations(rows, config)
    ]
    if partial:
        committed_rows = list(csv.DictReader(io.StringIO(committed_text)))
        stale = any(r not in committed_rows for r in rows)
    else:
        stale = committed_text != render_csv(rows)
    if stale:
        problems.append(
            f"LICENSE-3rdparty.csv is stale; run: python scripts/license_scan.py {regen_cmd}"
        )
    return problems


def run_pip_licenses():
    exe = shutil.which("pip-licenses")
    cmd = [exe] if exe else [sys.executable, "-m", "piplicenses"]
    cmd += ["--format=json", "--with-urls", "--with-authors"]
    out = subprocess.run(cmd, check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def run_npm_licenses():
    cmd = ["npx", "--no-install", "license-checker-rseidelsohn", "--json", "--production"]
    out = subprocess.run(cmd, check=True, capture_output=True, text=True, cwd=FRONTEND).stdout
    return json.loads(out)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["generate", "check"])
    parser.add_argument("--python", action="store_true")
    parser.add_argument("--npm", action="store_true")
    args = parser.parse_args(argv)
    if not args.python and not args.npm:
        args.python = args.npm = True
    full = args.python and args.npm
    flags = "" if full else (" --python" if args.python else " --npm")

    config = json.loads(CONFIG_PATH.read_text())
    py_rows = rows_from_pip_licenses(run_pip_licenses()) if args.python else []
    npm_rows = rows_from_npm_licenses(run_npm_licenses()) if args.npm else []
    rows = merge_rows(py_rows, npm_rows)
    for name in collisions(py_rows, npm_rows):
        print(f"warning: name collision between Python and npm: {name}", file=sys.stderr)

    committed = CSV_PATH.read_text() if CSV_PATH.exists() else ""
    if args.command == "generate":
        out_rows = rows
        if not full:
            names = {r["Component"] for r in rows}
            kept = [r for r in csv.DictReader(io.StringIO(committed)) if r["Component"] not in names]
            out_rows = merge_rows(kept, rows)
        CSV_PATH.write_text(render_csv(out_rows), newline="")
        print(f"wrote {CSV_PATH} ({len(out_rows)} components)")
        return 0

    problems = check_csv(rows, committed, config, partial=not full, regen_cmd=f"generate{flags}")
    for p in problems:
        print(p, file=sys.stderr)
    if not problems:
        print(f"license check OK ({len(rows)} components)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
