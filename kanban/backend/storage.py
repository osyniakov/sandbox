"""SQLite storage layer for the Kanban board.

The database path is read from the KANBAN_DB environment variable at
connection time on every request (default: "kanban.db" in the current
working directory). The schema is created on demand. No connections are
cached at import time.
"""

import contextlib
import os
import sqlite3
import uuid

COLUMNS = ("todo", "doing", "done")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id       TEXT PRIMARY KEY,
    title    TEXT NOT NULL,
    col      TEXT NOT NULL,
    position INTEGER NOT NULL
)
"""


class TaskNotFound(Exception):
    """Raised when a task id does not exist."""


@contextlib.contextmanager
def connect():
    """Open a fresh connection to the DB named by KANBAN_DB (per request).

    Commits on success, rolls back on error, always closes the connection.
    """
    db_path = os.environ.get("KANBAN_DB", "kanban.db")
    conn = sqlite3.connect(db_path)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute(_SCHEMA)
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def _row_to_task(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "column": row["col"],
        "position": row["position"],
    }


def _column_ids(conn: sqlite3.Connection, col: str) -> list:
    rows = conn.execute(
        "SELECT id FROM tasks WHERE col = ? ORDER BY position ASC", (col,)
    ).fetchall()
    return [r["id"] for r in rows]


def _write_order(conn: sqlite3.Connection, col: str, ids: list) -> None:
    """Assign contiguous 0-based positions (and the column) to ids, in order."""
    for pos, task_id in enumerate(ids):
        conn.execute(
            "UPDATE tasks SET col = ?, position = ? WHERE id = ?",
            (col, pos, task_id),
        )


def get_board() -> dict:
    with connect() as conn:
        board = {col: [] for col in COLUMNS}
        rows = conn.execute(
            "SELECT * FROM tasks ORDER BY col, position ASC"
        ).fetchall()
        for row in rows:
            board[row["col"]].append(_row_to_task(row))
        return board


def create_task(title: str, column: str) -> dict:
    with connect() as conn:
        (count,) = conn.execute(
            "SELECT COUNT(*) FROM tasks WHERE col = ?", (column,)
        ).fetchone()
        task_id = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO tasks (id, title, col, position) VALUES (?, ?, ?, ?)",
            (task_id, title, column, count),
        )
        return {"id": task_id, "title": title, "column": column, "position": count}


def _fetch_task(conn: sqlite3.Connection, task_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None:
        raise TaskNotFound(task_id)
    return row


def update_task(task_id: str, *, title=None, column=None, position=None) -> dict:
    """Apply the provided fields; None means "not provided".

    Move semantics per the contract:
    - column provided, position omitted -> append to end of target column.
    - position provided -> insert at that index in the target column
      (new column if given, else current), clamped to the end.
    - Positions in every affected column are re-normalized to 0..n-1.
    """
    with connect() as conn:
        row = _fetch_task(conn, task_id)

        if title is not None:
            conn.execute(
                "UPDATE tasks SET title = ? WHERE id = ?", (title, task_id)
            )

        if column is not None or position is not None:
            src_col = row["col"]
            dst_col = column if column is not None else src_col

            src_ids = _column_ids(conn, src_col)
            src_ids.remove(task_id)

            if dst_col == src_col:
                dst_ids = src_ids
            else:
                dst_ids = _column_ids(conn, dst_col)

            if position is None:
                insert_at = len(dst_ids)
            else:
                insert_at = min(position, len(dst_ids))
            dst_ids.insert(insert_at, task_id)

            if dst_col != src_col:
                _write_order(conn, src_col, src_ids)
            _write_order(conn, dst_col, dst_ids)

        return _row_to_task(_fetch_task(conn, task_id))


def delete_task(task_id: str) -> None:
    with connect() as conn:
        row = _fetch_task(conn, task_id)
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        remaining = _column_ids(conn, row["col"])
        _write_order(conn, row["col"], remaining)
