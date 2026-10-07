"""SPA fallback + docs relocation tests (sandbox-3kd.2)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.spa import register_spa


@pytest.fixture()
def static_dir(tmp_path: Path) -> Path:
    d = tmp_path / "static"
    (d / "assets").mkdir(parents=True)
    (d / "index.html").write_text("<html>INDEX</html>")
    (d / "assets" / "x.js").write_text("console.log(1)")
    (d / "sw.js").write_text("//sw")
    (d / "workbox-abc.js").write_text("//wb")
    (d / "manifest.webmanifest").write_text("{}")
    (d / "icon.svg").write_text("<svg/>")
    (tmp_path / "secret.txt").write_text("SECRET")
    return d


def _spa_client(static_dir: Path) -> TestClient:
    # Fresh app per test: no route leakage into the real app.
    import app.main as main_module

    fresh = FastAPI()
    fresh.include_router(main_module.api)
    assert register_spa(fresh, static_dir) is True
    return TestClient(fresh)


def test_spa_fallback_serves_index(static_dir: Path) -> None:
    c = _spa_client(static_dir)
    for path in ("/", "/items/12", "/inventory"):
        r = c.get(path)
        assert r.status_code == 200
        assert "INDEX" in r.text
        assert r.headers["cache-control"] == "no-cache"
        assert r.headers["x-content-type-options"] == "nosniff"
    assert c.head("/inventory").status_code == 200


def test_assets_immutable_and_content_types(static_dir: Path) -> None:
    c = _spa_client(static_dir)
    r = c.get("/assets/x.js")
    assert r.status_code == 200 and r.text == "console.log(1)"
    assert r.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert "javascript" in r.headers["content-type"]
    assert c.get("/manifest.webmanifest").headers["content-type"].startswith(
        "application/manifest+json"
    )
    assert c.get("/icon.svg").headers["content-type"].startswith("image/svg+xml")


def test_no_cache_files(static_dir: Path) -> None:
    c = _spa_client(static_dir)
    for path in ("/sw.js", "/workbox-abc.js", "/manifest.webmanifest"):
        assert c.get(path).headers["cache-control"] == "no-cache"


def test_api_routes_still_win(static_dir: Path) -> None:
    c = _spa_client(static_dir)
    assert c.get("/api/items").status_code == 401
    r = c.get("/api/nope")
    assert r.status_code == 404 and r.json() == {"detail": "Not Found"}
    assert c.get("/api").status_code == 404


@pytest.mark.parametrize(
    "path",
    ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/assets/../../secret.txt",
     "/%2e%2e%2fsecret.txt", "/x%00y"],
)
def test_traversal_never_escapes(static_dir: Path, path: str) -> None:
    c = _spa_client(static_dir)
    r = c.get(path)
    assert "SECRET" not in r.text
    assert r.status_code in (200, 404)
    if r.status_code == 200:
        assert "INDEX" in r.text


def test_directory_path_falls_back_to_index(static_dir: Path) -> None:
    c = _spa_client(static_dir)
    assert "INDEX" in c.get("/assets").text


def test_no_index_registers_nothing(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    fresh = FastAPI()
    assert register_spa(fresh, empty) is False
    assert TestClient(fresh).get("/").status_code == 404
    assert register_spa(fresh, tmp_path / "missing") is False


def test_real_app_has_no_spa_without_static(client: TestClient) -> None:
    assert client.get("/").status_code == 404


def test_docs_moved_under_api(client: TestClient) -> None:
    assert client.get("/api/docs").status_code == 200
    assert client.get("/api/redoc").status_code == 200
    assert client.get("/api/openapi.json").status_code == 200
    for p in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(p).status_code == 404
