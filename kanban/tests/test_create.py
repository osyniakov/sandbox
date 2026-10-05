"""POST /api/tasks"""

import re

import pytest

HEX32 = re.compile(r"^[0-9a-f]{32}$")


def test_create_returns_201_with_full_task_shape(client):
    response = client.post("/api/tasks", json={"title": "Buy milk", "column": "doing"})
    assert response.status_code == 201
    task = response.json()
    assert set(task) == {"id", "title", "column", "position"}
    assert HEX32.match(task["id"]), task["id"]
    assert task["title"] == "Buy milk"
    assert task["column"] == "doing"
    assert task["position"] == 0


def test_create_defaults_to_todo_column(client):
    task = client.post("/api/tasks", json={"title": "no column given"}).json()
    assert task["column"] == "todo"
    assert task["position"] == 0


def test_create_appends_to_end_of_column(client, create_task, get_board):
    first = create_task("first", column="done")
    second = create_task("second", column="done")
    assert first["position"] == 0
    assert second["position"] == 1
    assert [t["id"] for t in get_board()["done"]] == [first["id"], second["id"]]


def test_create_strips_title_whitespace(client):
    response = client.post("/api/tasks", json={"title": "  padded title \t\n"})
    assert response.status_code == 201
    assert response.json()["title"] == "padded title"


def test_create_ids_are_unique(create_task):
    ids = {create_task(f"t{i}")["id"] for i in range(5)}
    assert len(ids) == 5


@pytest.mark.parametrize(
    "body",
    [
        {},  # title missing
        {"title": ""},  # empty
        {"title": "   \t  "},  # whitespace-only
        {"title": "x" * 201},  # too long
        {"title": "ok", "column": "archive"},  # invalid column
    ],
    ids=["missing-title", "empty-title", "whitespace-title", "title-too-long", "invalid-column"],
)
def test_create_invalid_input_returns_422(client, body):
    response = client.post("/api/tasks", json=body)
    assert response.status_code == 422


def test_create_accepts_max_length_title(client):
    title = "x" * 200
    response = client.post("/api/tasks", json={"title": title})
    assert response.status_code == 201
    assert response.json()["title"] == title
