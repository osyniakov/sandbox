"""FastAPI application for the mini Kanban board.

Run with: uvicorn backend.app:app  (from inside kanban/).
"""

from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from backend import storage

Column = Literal["todo", "doing", "done"]

_FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


def _validate_title(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("title must be a string")
    stripped = value.strip()
    if not stripped:
        raise ValueError("title must be non-empty after stripping whitespace")
    if len(stripped) > 200:
        raise ValueError("title must be at most 200 characters")
    return stripped


class TaskCreate(BaseModel):
    title: str
    column: Column = "todo"

    @field_validator("title")
    @classmethod
    def check_title(cls, value: str) -> str:
        return _validate_title(value)


class TaskPatch(BaseModel):
    # None means "field not provided" (an explicit JSON null is treated the
    # same as omitting the field; the contract does not define null values).
    title: Optional[str] = Field(default=None)
    column: Optional[Column] = Field(default=None)
    position: Optional[int] = Field(default=None, ge=0)

    @field_validator("title")
    @classmethod
    def check_title(cls, value):
        if value is None:
            return value
        return _validate_title(value)


app = FastAPI(title="Kanban")


@app.get("/api/board")
def get_board():
    return {"columns": storage.get_board()}


@app.post("/api/tasks", status_code=201)
def create_task(body: TaskCreate):
    return storage.create_task(body.title, body.column)


@app.patch("/api/tasks/{task_id}")
def patch_task(task_id: str, body: TaskPatch):
    try:
        return storage.update_task(
            task_id,
            title=body.title,
            column=body.column,
            position=body.position,
        )
    except storage.TaskNotFound:
        raise HTTPException(status_code=404, detail="Task not found")


@app.delete("/api/tasks/{task_id}", status_code=204)
def delete_task(task_id: str):
    try:
        storage.delete_task(task_id)
    except storage.TaskNotFound:
        raise HTTPException(status_code=404, detail="Task not found")
    return Response(status_code=204)


# Mounted after the /api routes so it does not shadow them. check_dir=False
# tolerates the directory being empty or created later.
app.mount(
    "/",
    StaticFiles(directory=str(_FRONTEND_DIR), html=True, check_dir=False),
    name="frontend",
)
