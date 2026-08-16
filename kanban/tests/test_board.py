"""GET /api/board"""

from conftest import COLUMNS


def test_empty_board_has_all_three_empty_columns(client):
    response = client.get("/api/board")
    assert response.status_code == 200
    body = response.json()
    assert body == {"columns": {"todo": [], "doing": [], "done": []}}


def test_board_lists_tasks_in_position_order(client, create_task, get_board):
    created = [create_task(f"task {i}", column="doing") for i in range(3)]

    columns = get_board()
    assert set(columns) == set(COLUMNS)
    doing = columns["doing"]
    assert [t["position"] for t in doing] == [0, 1, 2]
    assert [t["id"] for t in doing] == [t["id"] for t in created]
    assert [t["title"] for t in doing] == ["task 0", "task 1", "task 2"]
    assert columns["todo"] == []
    assert columns["done"] == []
