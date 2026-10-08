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


NPM_JSON = {
    "frontend@0.0.0": {"licenses": "UNLICENSED", "private": True},
    "@scope/pkg@1.2.3": {"licenses": "MIT", "publisher": "Scoped Author"},
    "dual@2.0.0": {"licenses": ["MIT", "GPL-3.0"], "publisher": "UNKNOWN"},
    "Mystery@0.1.0": {"licenses": "UNKNOWN"},
    "paren@3.0.0": {"licenses": "(MIT OR GPL-3.0)"},
}


def test_npm_rows_skip_private_root_and_keep_scoped_names():
    rows = ls.rows_from_npm_licenses(NPM_JSON)
    assert [r["Component"] for r in rows] == ["@scope/pkg", "dual", "Mystery", "paren"]
    assert rows[0] == {
        "Component": "@scope/pkg",
        "Origin": "1.2.3",
        "License": "MIT",
        "Copyright": "Scoped Author",
    }


def test_npm_array_unknown_and_paren_licenses():
    by_name = {r["Component"]: r for r in ls.rows_from_npm_licenses(NPM_JSON)}
    assert by_name["dual"]["License"] == "MIT; GPL-3.0"
    assert by_name["dual"]["Copyright"] == ""
    assert by_name["Mystery"]["License"] == "UNKNOWN"
    assert by_name["paren"]["License"] == "MIT OR GPL-3.0"
    bad = ls.violations(list(by_name.values()), CONFIG)
    assert {r["Component"] for r in bad} == {"dual", "Mystery"}


def test_npm_missing_licenses_is_unknown():
    rows = ls.rows_from_npm_licenses({"x@1.0.0": {}})
    assert rows[0]["License"] == "UNKNOWN"


def test_npm_reviewed_exception_must_store_license():
    rows = ls.rows_from_npm_licenses({"x@1.0.0": {"licenses": "GPL-3.0"}})
    ok = {**CONFIG, "reviewed": {"x": {"license": "GPL-3.0", "reason": "r"}}}
    changed = {**CONFIG, "reviewed": {"x": {"license": "MIT-0", "reason": "r"}}}
    assert ls.violations(rows, ok) == []
    assert ls.violations(rows, changed) == rows


def test_combined_sort_across_ecosystems_and_collision_kept():
    py = ls.rows_from_pip_licenses(PIP_JSON)
    npm = ls.rows_from_npm_licenses(
        {"Beta@9.0.0": {"licenses": "MIT"}, "@scope/pkg@1.0.0": {"licenses": "MIT"}}
    )
    merged = ls.merge_rows(py, npm)
    assert [r["Component"] for r in merged] == ["@scope/pkg", "Alpha", "Beta", "beta", "zeta"]
    assert merged[2]["Origin"] == "9.0.0" and merged[3]["Origin"] == "3.1"
    assert ls.collisions(py, npm) == ["beta"]


def test_partial_check_accepts_subset_of_committed_csv():
    npm = ls.rows_from_npm_licenses({"a@1.0.0": {"licenses": "MIT"}})
    py = ls.rows_from_pip_licenses(PIP_JSON)
    committed = ls.render_csv(ls.merge_rows(py, npm))
    assert ls.check_csv(npm, committed, CONFIG, partial=True) == []
    stale = ls.check_csv(npm, ls.render_csv(py), CONFIG, partial=True)
    assert len(stale) == 1 and "stale" in stale[0]
