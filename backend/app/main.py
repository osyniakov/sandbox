"""FastAPI application entrypoint.

Scaffolding only: no Kleinanzeigen, vision-API, or database logic here.
Those concerns belong to later beads.
"""

from fastapi import FastAPI

app = FastAPI(title="Basement Declutter API")


@app.get("/health")
def health() -> dict[str, str]:
    """Basic liveness check."""
    return {"status": "ok"}
