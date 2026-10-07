from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_old_unprefixed_paths_are_not_api_routes() -> None:
    for path in ("/items", "/auth/me", "/uploads/x", "/health"):
        assert client.get(path).status_code == 404, path


def test_uploads_prefix_gate_is_exact() -> None:
    # Exact prefix and children are auth-gated (401 without a session)...
    assert client.get("/api/uploads").status_code == 401
    assert client.get("/api/uploads/x.jpg").status_code == 401
    # ...but a sibling path sharing the string prefix is not gated: plain 404.
    assert client.get("/api/uploadsX").status_code == 404
    assert client.get("/api/uploadsX/y.jpg").status_code == 404
