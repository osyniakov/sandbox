"""Serve the built frontend (Vite ``dist``) with an SPA fallback.

``register_spa(app, static_dir)`` adds a catch-all GET/HEAD route. It must be
called AFTER the ``/api`` router and the ``/api/uploads`` mount are added so
those keep precedence. If ``static_dir`` has no ``index.html`` nothing is
registered.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, Response

logger = logging.getLogger(__name__)

_IMMUTABLE = "public, max-age=31536000, immutable"
_NO_CACHE = "no-cache"
_NO_CACHE_NAMES = {"index.html", "sw.js", "registerSW.js", "manifest.webmanifest"}

_MEDIA_TYPES = {
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".js": "text/javascript",
    ".css": "text/css",
    ".html": "text/html",
}


def _cache_control(rel: Path) -> str | None:
    if rel.parts and rel.parts[0] == "assets":
        return _IMMUTABLE
    name = rel.name
    if name in _NO_CACHE_NAMES or (name.startswith("workbox-") and name.endswith(".js")):
        return _NO_CACHE
    return None


def _file_response(path: Path, root: Path) -> FileResponse:
    headers = {"X-Content-Type-Options": "nosniff"}
    cc = _cache_control(path.relative_to(root))
    if cc:
        headers["Cache-Control"] = cc
    return FileResponse(
        path, media_type=_MEDIA_TYPES.get(path.suffix.lower()), headers=headers
    )


def register_spa(app: FastAPI, static_dir: str | Path) -> bool:
    """Register the SPA catch-all on ``app``. Returns True if registered."""
    root = Path(static_dir).resolve()
    index = root / "index.html"
    if not index.is_file():
        logger.info("No index.html in %s; not serving a frontend.", root)
        return False

    @app.api_route(
        "/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False
    )
    def spa(full_path: str) -> Response:
        if full_path == "api" or full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        if full_path:
            try:
                candidate = (root / full_path).resolve()
                if candidate.is_relative_to(root) and candidate.is_file():
                    return _file_response(candidate, root)
            except (OSError, ValueError):
                pass
        return _file_response(index.resolve(), root)

    return True
