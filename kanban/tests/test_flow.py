"""End-to-end flow across create, move, reorder, and delete."""


def test_full_board_lifecycle(client, create_task, get_board):
    # Create five tasks: three in todo, two in doing.
    a = create_task("write spec", column="todo")
    b = create_task("build backend", column="todo")
    c = create_task("build frontend", column="todo")
    d = create_task("review", column="doing")
    e = create_task("deploy", column="doing")

    # Move "build backend" to doing at the front; doing shifts.
    r = client.patch(f"/api/tasks/{b['id']}", json={"column": "doing", "position": 0})
    assert r.status_code == 200

    # Move "write spec" straight to done (appended).
    r = client.patch(f"/api/tasks/{a['id']}", json={"column": "done"})
    assert r.status_code == 200

    # Reorder within doing: move "deploy" (now last) to index 1.
    r = client.patch(f"/api/tasks/{e['id']}", json={"position": 1})
    assert r.status_code == 200

    # Rename the frontend task.
    r = client.patch(f"/api/tasks/{c['id']}", json={"title": "polish frontend"})
    assert r.status_code == 200

    # Delete "review".
    r = client.delete(f"/api/tasks/{d['id']}")
    assert r.status_code == 204

    # Verify the final board state exactly.
    columns = get_board()
    assert columns == {
        "todo": [
            {"id": c["id"], "title": "polish frontend", "column": "todo", "position": 0},
        ],
        "doing": [
            {"id": b["id"], "title": "build backend", "column": "doing", "position": 0},
            {"id": e["id"], "title": "deploy", "column": "doing", "position": 1},
        ],
        "done": [
            {"id": a["id"], "title": "write spec", "column": "done", "position": 0},
        ],
    }
