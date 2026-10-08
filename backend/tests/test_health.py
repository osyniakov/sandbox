from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_old_unprefixed_paths_are_not_api_routes() -> None:
    for path in ("/items", "/auth/me", "/uploads/x"):
        assert client.get(path).status_code == 404, path


def test_uploads_prefix_gate_is_exact() -> None:
    # Exact prefix and children are auth-gated (401 without a session)...
    assert client.get("/api/uploads").status_code == 401
    assert client.get("/api/uploads/x.jpg").status_code == 401
    # ...but a sibling path sharing the string prefix is not gated: plain 404.
    assert client.get("/api/uploadsX").status_code == 404
    assert client.get("/api/uploadsX/y.jpg").status_code == 404


def test_root_health_alias_matches_api_health() -> None:
    api_resp = client.get("/api/health")
    for resp in (client.get("/health"), client.head("/health")):
        assert resp.status_code == 200
    got = client.get("/health")
    assert got.json() == api_resp.json() == {"status": "ok"}
    assert got.headers["content-type"] == api_resp.headers["content-type"]


def test_root_health_alias_not_shadowed_by_spa(tmp_path) -> None:
    from fastapi import FastAPI

    import app.main as main_module
    from app.spa import register_spa

    (tmp_path / "index.html").write_text("<html>INDEX</html>")
    fresh = FastAPI()
    fresh.include_router(main_module.api)
    fresh.add_api_route(
        "/health", main_module.health, methods=["GET", "HEAD"], include_in_schema=False
    )
    assert register_spa(fresh, tmp_path) is True
    c = TestClient(fresh)
    assert c.get("/health").json() == {"status": "ok"}
    assert c.head("/health").status_code == 200


def test_real_app_registers_health_before_spa_catchall() -> None:
    paths = [getattr(r, "path", None) for r in app.routes]
    assert "/health" in paths
    if "/{full_path:path}" in paths:
        assert paths.index("/health") < paths.index("/{full_path:path}")
