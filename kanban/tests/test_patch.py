"""PATCH /api/tasks/{id}"""

import pytest


def ids(column_tasks):
    return [t["id"] for t in column_tasks]


def positions(column_tasks):
    return [t["position"] for t in column_tasks]


def test_patch_title_only(client, create_task, get_board):
    task = create_task("old title", column="doing")

    response = client.patch(f"/api/tasks/{task['id']}", json={"title": "  new title  "})
    assert response.status_code == 200
    updated = response.json()
    assert updated["title"] == "new title"  # stripped
    assert updated["id"] == task["id"]
    assert updated["column"] == "doing"
    assert updated["position"] == 0

    assert get_board()["doing"][0]["title"] == "new title"


def test_move_to_other_column_without_position_appends(client, create_task, get_board):
    existing = create_task("already in done", column="done")
    mover = create_task("mover", column="todo")

    response = client.patch(f"/api/tasks/{mover['id']}", json={"column": "done"})
    assert response.status_code == 200
    updated = response.json()
    assert updated["column"] == "done"
    assert updated["position"] == 1  # appended after the existing task

    columns = get_board()
    assert columns["todo"] == []
    assert ids(columns["done"]) == [existing["id"], mover["id"]]


def test_move_with_explicit_position_inserts_and_shifts(client, create_task, get_board):
    done = [create_task(f"done {i}", column="done") for i in range(3)]
    mover = create_task("mover", column="todo")

    response = client.patch(f"/api/tasks/{mover['id']}", json={"column": "done", "position": 1})
    assert response.status_code == 200
    assert response.json()["column"] == "done"
    assert response.json()["position"] == 1

    columns = get_board()
    assert ids(columns["done"]) == [done[0]["id"], mover["id"], done[1]["id"], done[2]["id"]]
    assert positions(columns["done"]) == [0, 1, 2, 3]


def test_move_position_beyond_end_is_clamped(client, create_task, get_board):
    existing = create_task("existing", column="doing")
    mover = create_task("mover", column="todo")

    response = client.patch(f"/api/tasks/{mover['id']}", json={"column": "doing", "position": 99})
    assert response.status_code == 200
    assert response.json()["position"] == 1  # clamped to end of target column

    assert ids(get_board()["doing"]) == [existing["id"], mover["id"]]


def test_same_column_reorder(client, create_task, get_board):
    tasks = [create_task(f"t{i}", column="todo") for i in range(3)]

    # Move the last task to the front of its own column (no `column` field).
    response = client.patch(f"/api/tasks/{tasks[2]['id']}", json={"position": 0})
    assert response.status_code == 200
    assert response.json()["column"] == "todo"
    assert response.json()["position"] == 0

    todo = get_board()["todo"]
    assert ids(todo) == [tasks[2]["id"], tasks[0]["id"], tasks[1]["id"]]
    assert positions(todo) == [0, 1, 2]


def test_move_renormalizes_source_column(client, create_task, get_board):
    tasks = [create_task(f"t{i}", column="todo") for i in range(3)]

    # Move the middle task away; the source column must close the gap.
    response = client.patch(f"/api/tasks/{tasks[1]['id']}", json={"column": "done"})
    assert response.status_code == 200

    columns = get_board()
    assert ids(columns["todo"]) == [tasks[0]["id"], tasks[2]["id"]]
    assert positions(columns["todo"]) == [0, 1]
    assert positions(columns["done"]) == [0]


def test_patch_empty_body_is_noop(client, create_task, get_board):
    task = create_task("untouched", column="doing")

    response = client.patch(f"/api/tasks/{task['id']}", json={})
    assert response.status_code == 200
    assert response.json() == task

    assert get_board()["doing"] == [task]


def test_patch_unknown_id_returns_404(client):
    response = client.patch(f"/api/tasks/{'0' * 32}", json={"title": "nope"})
    assert response.status_code == 404
    assert response.json() == {"detail": "Task not found"}


@pytest.mark.parametrize(
    "body",
    [
        {"title": ""},
        {"title": "   "},
        {"title": "x" * 201},
        {"column": "backlog"},
        {"position": -1},
    ],
    ids=["empty-title", "whitespace-title", "title-too-long", "invalid-column", "negative-position"],
)
def test_patch_invalid_input_returns_422(client, create_task, body):
    task = create_task("valid task")
    response = client.patch(f"/api/tasks/{task['id']}", json=body)
    assert response.status_code == 422
