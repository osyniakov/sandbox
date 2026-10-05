"""DELETE /api/tasks/{id}"""


def test_delete_returns_204_with_empty_body(client, create_task, get_board):
    task = create_task("doomed")

    response = client.delete(f"/api/tasks/{task['id']}")
    assert response.status_code == 204
    assert response.content == b""

    assert get_board() == {"todo": [], "doing": [], "done": []}


def test_delete_renormalizes_remaining_positions(client, create_task, get_board):
    tasks = [create_task(f"t{i}", column="doing") for i in range(3)]

    response = client.delete(f"/api/tasks/{tasks[0]['id']}")
    assert response.status_code == 204

    doing = get_board()["doing"]
    assert [t["id"] for t in doing] == [tasks[1]["id"], tasks[2]["id"]]
    assert [t["position"] for t in doing] == [0, 1]


def test_delete_unknown_id_returns_404(client):
    response = client.delete(f"/api/tasks/{'f' * 32}")
    assert response.status_code == 404
    assert response.json() == {"detail": "Task not found"}


def test_delete_twice_returns_404_second_time(client, create_task):
    task = create_task("only once")
    assert client.delete(f"/api/tasks/{task['id']}").status_code == 204
    assert client.delete(f"/api/tasks/{task['id']}").status_code == 404
