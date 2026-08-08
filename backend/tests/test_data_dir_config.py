"""Tests for the ``DATA_DIR`` env var override of the default SQLite DB
path (``app.db.DEFAULT_DB_PATH`` / ``app.db._default_db_path``) and the
default uploads directory (``app.main.UPLOAD_DIR`` /
``app.main._default_upload_dir``).

These exercise the pure path-computation helpers directly (rather than
reimporting the modules with the env var set, which would be fragile /
order-dependent given ``app.db``'s module-level ``engine = make_engine()``
side effect), plus the directory-creation behavior in ``make_engine`` and
the FastAPI ``lifespan``.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.db as db_module
import app.main as main_module
from app.db import _default_db_path, get_session, make_engine, make_session_factory
from app.main import _default_upload_dir, app


# ---------------------------------------------------------------------------
# app.db._default_db_path / DEFAULT_DB_PATH
# ---------------------------------------------------------------------------


def test_default_db_path_unset_matches_original_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("DATA_DIR", raising=False)
    expected = Path(db_module.__file__).resolve().parent.parent / "data" / "declutter.db"
    assert _default_db_path() == expected


def test_default_db_path_empty_string_matches_original_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATA_DIR", "")
    expected = Path(db_module.__file__).resolve().parent.parent / "data" / "declutter.db"
    assert _default_db_path() == expected


def test_default_db_path_uses_data_dir_when_set(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    assert _default_db_path() == tmp_path / "declutter.db"


def test_default_db_path_is_module_level_path_constant() -> None:
    # DEFAULT_DB_PATH must stay a module-level Path constant -- other
    # code/tests may import or monkeypatch it directly.
    assert isinstance(db_module.DEFAULT_DB_PATH, Path)


def test_make_engine_creates_parent_dir_of_default_db_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``make_engine(db_url=None)`` must create ``DEFAULT_DB_PATH``'s
    parent directory if missing, regardless of whether DATA_DIR is
    involved. Monkeypatches the module-level ``DEFAULT_DB_PATH`` constant
    (rather than relying on env-var reimport) so this never touches the
    real dev DB directory.
    """
    fake_default = tmp_path / "some-data-dir" / "declutter.db"
    assert not fake_default.parent.exists()
    monkeypatch.setattr(db_module, "DEFAULT_DB_PATH", fake_default)

    engine = make_engine()

    assert fake_default.parent.exists()
    assert str(fake_default) in str(engine.url)
    engine.dispose()


# ---------------------------------------------------------------------------
# app.main._default_upload_dir / UPLOAD_DIR
# ---------------------------------------------------------------------------


def test_default_upload_dir_unset_matches_original_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("DATA_DIR", raising=False)
    expected = Path(main_module.__file__).resolve().parent.parent / "uploads"
    assert _default_upload_dir() == expected


def test_default_upload_dir_empty_string_matches_original_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATA_DIR", "")
    expected = Path(main_module.__file__).resolve().parent.parent / "uploads"
    assert _default_upload_dir() == expected


def test_default_upload_dir_uses_data_dir_when_set(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    assert _default_upload_dir() == tmp_path / "uploads"


def test_upload_dir_is_module_level_path_constant() -> None:
    # UPLOAD_DIR must stay a module-level Path constant -- other code/tests
    # (see e.g. tests/test_items_upload.py) monkeypatch it directly.
    assert isinstance(main_module.UPLOAD_DIR, Path)


def test_lifespan_creates_upload_dir_when_it_points_under_data_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Mirrors the existing "UPLOAD_DIR created lazily" behavior
    (tests/test_uploads_static.py), but for an UPLOAD_DIR value shaped
    like what a DATA_DIR-driven default would produce (a subdirectory of
    a not-yet-existing parent). Drives it through the real FastAPI
    ``lifespan`` (not a bare ``mkdir`` call) so this actually exercises
    the app startup path a DATA_DIR-configured deployment would hit.
    """
    db_path = tmp_path / "test.db"
    test_engine = make_engine(f"sqlite:///{db_path}")
    factory = make_session_factory(test_engine)

    def _get_session_override() -> Iterator:
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = _get_session_override
    monkeypatch.setattr(main_module, "engine", test_engine)

    fake_upload_dir = tmp_path / "some-data-dir" / "uploads"
    assert not fake_upload_dir.parent.exists()
    monkeypatch.setattr(main_module, "UPLOAD_DIR", fake_upload_dir)

    with TestClient(app):  # `with` triggers lifespan startup/shutdown
        pass

    app.dependency_overrides.clear()
    assert fake_upload_dir.exists()
    test_engine.dispose()
