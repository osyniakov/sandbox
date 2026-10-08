import importlib.util
from pathlib import Path

_path = Path(__file__).resolve().parents[2] / "scripts" / "license_scan.py"
_spec = importlib.util.spec_from_file_location("license_scan", _path)
ls = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ls)

CONFIG = {"allowed": ["MIT", "Apache-2.0", "BSD License"], "reviewed": {}}

PIP_JSON = [
    {"Name": "zeta", "Version": "1.0", "License": "MIT", "Author": "Z Author", "URL": "u"},
    {"Name": "Alpha", "Version": "2.0", "License": "Apache-2.0", "Author": "UNKNOWN", "URL": "u"},
    {"Name": "backend", "Version": "0", "License": "GPL", "Author": "me", "URL": "u"},
    {"Name": "beta", "Version": "3.1", "License": "BSD License", "Author": "B, C", "URL": "u"},
]


def test_allowlist_case_insensitive():
    assert ls.is_allowed("mit", CONFIG["allowed"])
    assert ls.is_allowed("APACHE-2.0", CONFIG["allowed"])


def test_allowlist_or_expression():
    assert ls.is_allowed("GPL-3.0 OR MIT", CONFIG["allowed"])
    assert not ls.is_allowed("GPL-3.0 OR AGPL-3.0", CONFIG["allowed"])


def test_unknown_license_fails_and_reviewed_passes():
    rows = [{"Component": "x", "Origin": "1", "License": "GPL-3.0", "Copyright": ""}]
    assert ls.violations(rows, CONFIG) == rows
    reviewed = {**CONFIG, "reviewed": {"x": {"license": "GPL-3.0", "reason": "checked"}}}
    assert ls.violations(rows, reviewed) == []


def test_reviewed_exception_fails_when_license_changes():
    rows = [{"Component": "x", "Origin": "2", "License": "AGPL-3.0", "Copyright": ""}]
    cfg = {**CONFIG, "reviewed": {"x": {"license": "GPL-3.0", "reason": "checked"}}}
    assert ls.violations(rows, cfg) == rows


def test_semicolon_and_and_are_not_allowed():
    assert not ls.is_allowed("GPL-3.0; MIT", CONFIG["allowed"])
    assert not ls.is_allowed("MIT AND GPL-3.0", CONFIG["allowed"])


def test_rows_sorted_case_insensitive_and_excludes_project():
    rows = ls.rows_from_pip_licenses(PIP_JSON)
    assert [r["Component"] for r in rows] == ["Alpha", "beta", "zeta"]
    assert rows[0]["Copyright"] == ""


def test_render_csv_columns():
    text = ls.render_csv(ls.rows_from_pip_licenses(PIP_JSON))
    lines = text.splitlines()
    assert lines[0] == "Component,Origin,License,Copyright"
    assert lines[1] == "Alpha,2.0,Apache-2.0,"
    assert lines[2] == 'beta,3.1,BSD License,"B, C"'


def test_check_fails_on_stale_csv_and_passes_when_fresh():
    rows = ls.rows_from_pip_licenses(PIP_JSON)
    fresh = ls.render_csv(rows)
    assert ls.check_csv(rows, fresh, CONFIG) == []
    problems = ls.check_csv(rows, fresh + "extra,1,MIT,\n", CONFIG)
    assert len(problems) == 1 and "stale" in problems[0]
