"""Shared fixtures for the Kanban API black-box test suite.

The backend is imported lazily inside the ``client`` fixture so that test
collection succeeds even when ``backend/`` does not exist yet. Per the
contract, the SQLite path is read from the ``KANBAN_DB`` environment
variable at connection time on every request, so pointing it at a fresh
tmp_path file per test yields a fully isolated database.
"""

import sys
from pathlib import Path

import pytest

# Make `backend` importable regardless of where pytest is invoked from:
# the kanban/ directory (this file's parent's parent) must be on sys.path.
KANBAN_DIR = Path(__file__).resolve().parent.parent
if str(KANBAN_DIR) not in sys.path:
    sys.path.insert(0, str(KANBAN_DIR))

COLUMNS = ("todo", "doing", "done")


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A TestClient bound to a fresh, empty database."""
    monkeypatch.setenv("KANBAN_DB", str(tmp_path / "test.db"))

    from fastapi.testclient import TestClient

    from backend.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def create_task(client):
    """Create a task via the API and return the created Task dict."""

    def _create(title, column=None):
        body = {"title": title}
        if column is not None:
            body["column"] = column
        response = client.post("/api/tasks", json=body)
        assert response.status_code == 201, response.text
        return response.json()

    return _create


@pytest.fixture
def get_board(client):
    """Fetch the board and return the `columns` mapping."""

    def _get():
        response = client.get("/api/board")
        assert response.status_code == 200, response.text
        return response.json()["columns"]

    return _get
