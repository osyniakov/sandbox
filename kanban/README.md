# Mini Kanban Board — a multi-agent development experiment

A small Kanban web app (To Do / Doing / Done, drag-and-drop) built as an
experiment in **parallel multi-agent development**: an orchestrator wrote
[`API_CONTRACT.md`](API_CONTRACT.md) first, then three independent agents
built `backend/`, `frontend/`, and `tests/` concurrently against the
contract — never seeing each other's code — and the orchestrator integrated
the results.

## Run it

```bash
pip install fastapi uvicorn
cd kanban
uvicorn backend.app:app
# open http://127.0.0.1:8000/
```

## Test it

```bash
pip install fastapi pytest httpx
cd kanban
pytest tests/
```

## Experiment notes

_(filled in after integration)_
