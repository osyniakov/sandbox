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

**Setup.** The orchestrator wrote `API_CONTRACT.md` and committed it, then
spawned three agents concurrently, each locked to one directory and given
only the contract: a backend agent (FastAPI + stdlib sqlite3), a frontend
agent (vanilla HTML/CSS/JS, native drag-and-drop), and a test agent that
wrote 31 black-box pytest tests *before the backend existed*, deferring the
`backend.app` import into fixtures so the suite collected cleanly on day
zero.

**Result.** On first contact, the independently written backend passed all
31 independently written tests — zero changes on either side of the API
seam. The browser end-to-end pass (Playwright driving create, cross-column
drag, inline edit, delete, reload-persistence) also required zero changes
to agent code; the only failures during integration were bugs in the
orchestrator's own test-driver selectors (the frontend legitimately puts
`data-column` on both a column's `<section>` and its inner task list, which
broke naive attribute selectors twice).

**What made it work.**
- The contract pinned the things integrations usually die on: exact status
  codes, the 404 body, position clamping and re-normalization, the ASGI
  import path, and that `KANBAN_DB` is resolved per request (which is what
  let tests isolate themselves with just an env var).
- Disjoint directory ownership meant no merge conflicts by construction.
- Each agent self-verified within its own boundary (backend: 56-assertion
  smoke script; frontend: Playwright against a stubbed fetch, which caught
  two real drag-and-drop bugs pre-integration; tests: collect-only).

**Where the seams still showed.** Both coding agents made judgment calls in
corners the contract didn't specify — explicit JSON `null` in PATCH bodies
(backend treats it as omitted), whether a same-column move index is
computed before or after removing the moving card (both sides happened to
pick remove-then-insert), float coercion for `position`. None collided this
time, but each one is a latent interop bug a stricter contract (or a
contract-conformance suite both sides must run) would have closed.
