"""Tests for multi-photo create, add/remove photo, and photos in item JSON."""

from __future__ import annotations

from pathlib import Path

import pytest

import app.main as main_module
from app.models import Item, ItemPhoto, ItemStatus
from tests.conftest import _make_jpeg_bytes

JPEG = _make_jpeg_bytes()


def _files(n: int, field: str = "photos"):
    return [(field, (f"p{i}.jpg", JPEG, "image/jpeg")) for i in range(n)]


def _uploads() -> list[Path]:
    d = main_module.UPLOAD_DIR
    return sorted(d.iterdir()) if d.exists() else []


def _create(client, headers, n=3):
    r = client.post("/items", files=_files(n), headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_create_with_legacy_single_photo(client, auth_headers) -> None:
    r = client.post("/items", files=_files(1, "photo"), headers=auth_headers)
    assert r.status_code == 201
    assert set(r.json()) == {"id", "status", "photo_path"}
    item = client.get(f"/items/{r.json()['id']}", headers=auth_headers).json()
    assert [p["position"] for p in item["photos"]] == [0]
    assert item["photos"][0]["url"] == item["photo_url"]


def test_create_with_three_photos_in_order(client, auth_headers) -> None:
    r = client.post("/items", files=_files(3), headers=auth_headers)
    assert r.status_code == 201
    item = client.get(f"/items/{r.json()['id']}", headers=auth_headers).json()
    assert [p["position"] for p in item["photos"]] == [0, 1, 2]
    assert item["photos"][0]["url"] == item["photo_url"]
    assert len(_uploads()) == 3


def test_create_photos_plus_legacy_photo(client, auth_headers) -> None:
    files = _files(2) + _files(1, "photo")
    r = client.post("/items", files=files, headers=auth_headers)
    assert r.status_code == 201
    item = client.get(f"/items/{r.json()['id']}", headers=auth_headers).json()
    assert len(item["photos"]) == 3


def test_create_with_eleven_rejected_no_files(client, db_session_factory, auth_headers) -> None:
    r = client.post("/items", files=_files(11), headers=auth_headers)
    assert r.status_code == 400
    assert r.json()["detail"] == "At most 10 photos per item."
    assert _uploads() == []
    assert client.get("/items", headers=auth_headers).json() == []


def test_create_with_ten_ok(client, auth_headers) -> None:
    assert client.post("/items", files=_files(10), headers=auth_headers).status_code == 201


def test_create_with_bad_file_among_good_is_atomic(client, auth_headers) -> None:
    files = _files(2) + [("photos", ("x.jpg", b"not an image at all", "image/jpeg"))]
    r = client.post("/items", files=files, headers=auth_headers)
    assert r.status_code == 400
    assert _uploads() == []
    assert client.get("/items", headers=auth_headers).json() == []


def test_create_with_no_photos_400(client, auth_headers) -> None:
    r = client.post("/items", data={"hint": "x"}, headers=auth_headers)
    assert r.status_code == 400
    assert r.json()["detail"] == "No photo file was uploaded."


def test_add_photos(client, auth_headers) -> None:
    iid = _create(client, auth_headers, 2)
    r = client.post(f"/items/{iid}/photos", files=_files(2), headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert [p["position"] for p in body["photos"]] == [0, 1, 2, 3]
    assert body["status"] in {s.value for s in ItemStatus}
    assert len(_uploads()) == 4


def test_add_photos_exceeding_ten_400_nothing_saved(client, auth_headers) -> None:
    iid = _create(client, auth_headers, 9)
    r = client.post(f"/items/{iid}/photos", files=_files(2), headers=auth_headers)
    assert r.status_code == 400
    assert r.json()["detail"] == "At most 10 photos per item."
    assert len(_uploads()) == 9
    assert len(client.get(f"/items/{iid}", headers=auth_headers).json()["photos"]) == 9


def test_add_photos_bad_file_cleans_up(client, auth_headers) -> None:
    iid = _create(client, auth_headers, 1)
    files = _files(1) + [("photos", ("x.jpg", b"garbage", "image/jpeg"))]
    r = client.post(f"/items/{iid}/photos", files=files, headers=auth_headers)
    assert r.status_code == 400
    assert len(_uploads()) == 1


def test_add_photos_unknown_item_404_and_requires_auth(client, auth_headers) -> None:
    assert client.post("/items/999/photos", files=_files(1), headers=auth_headers).status_code == 404
    iid = _create(client, auth_headers, 1)
    assert client.post(f"/items/{iid}/photos", files=_files(1)).status_code == 401


def test_delete_middle_photo_renumbers(client, auth_headers) -> None:
    iid = _create(client, auth_headers, 3)
    photos = client.get(f"/items/{iid}", headers=auth_headers).json()["photos"]
    r = client.delete(f"/items/{iid}/photos/{photos[1]['id']}", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert [p["position"] for p in body["photos"]] == [0, 1]
    assert [p["id"] for p in body["photos"]] == [photos[0]["id"], photos[2]["id"]]
    assert body["photo_url"] == photos[0]["url"]
    assert len(_uploads()) == 2


def test_delete_cover_promotes_next(client, auth_headers) -> None:
    iid = _create(client, auth_headers, 3)
    photos = client.get(f"/items/{iid}", headers=auth_headers).json()["photos"]
    r = client.delete(f"/items/{iid}/photos/{photos[0]['id']}", headers=auth_headers)
    body = r.json()
    assert body["photo_url"] == photos[1]["url"]
    assert body["photos"][0]["id"] == photos[1]["id"]
    assert body["photos"][0]["position"] == 0
    assert body["photo_path"].endswith(Path(photos[1]["url"]).name)
    assert len(_uploads()) == 2


def test_delete_last_photo_409(client, auth_headers) -> None:
    iid = _create(client, auth_headers, 1)
    pid = client.get(f"/items/{iid}", headers=auth_headers).json()["photos"][0]["id"]
    r = client.delete(f"/items/{iid}/photos/{pid}", headers=auth_headers)
    assert r.status_code == 409
    assert r.json()["detail"] == "An item must keep at least one photo."
    assert len(_uploads()) == 1


def test_delete_photo_wrong_item_404(client, auth_headers) -> None:
    a = _create(client, auth_headers, 2)
    b = _create(client, auth_headers, 2)
    pid = client.get(f"/items/{a}", headers=auth_headers).json()["photos"][0]["id"]
    assert client.delete(f"/items/{b}/photos/{pid}", headers=auth_headers).status_code == 404
    assert client.delete(f"/items/{b}/photos/99999", headers=auth_headers).status_code == 404
    assert client.delete(f"/items/{a}/photos/{pid}").status_code == 401


def test_delete_item_removes_all_files(client, auth_headers) -> None:
    iid = _create(client, auth_headers, 3)
    assert len(_uploads()) == 3
    assert client.delete(f"/items/{iid}", headers=auth_headers).status_code == 200
    assert _uploads() == []


def _make_legacy_item(db_session_factory) -> tuple[int, Path]:
    path = main_module.UPLOAD_DIR / "legacy.jpg"
    path.write_bytes(JPEG)
    s = db_session_factory()
    try:
        item = Item(photo_path=str(path), status=ItemStatus.PENDING_IDENTIFICATION)
        s.add(item)
        s.commit()
        return item.id, path
    finally:
        s.close()


def test_legacy_item_without_photo_rows_serializes_single_photo(
    client, db_session_factory, auth_headers
) -> None:
    iid, _ = _make_legacy_item(db_session_factory)
    body = client.get(f"/items/{iid}", headers=auth_headers).json()
    assert body["photos"] == [{"id": None, "url": body["photo_url"], "position": 0}]


def test_legacy_item_add_materializes_row(client, db_session_factory, auth_headers) -> None:
    iid, _ = _make_legacy_item(db_session_factory)
    body = client.post(f"/items/{iid}/photos", files=_files(1), headers=auth_headers).json()
    assert [p["position"] for p in body["photos"]] == [0, 1]
    assert all(p["id"] is not None for p in body["photos"])
    assert body["photos"][0]["url"] == body["photo_url"]


def test_legacy_item_remove_cover_after_add(client, db_session_factory, auth_headers) -> None:
    iid, path = _make_legacy_item(db_session_factory)
    body = client.post(f"/items/{iid}/photos", files=_files(1), headers=auth_headers).json()
    r = client.delete(f"/items/{iid}/photos/{body['photos'][0]['id']}", headers=auth_headers)
    assert r.status_code == 200
    assert not path.exists()
    assert len(r.json()["photos"]) == 1


def test_legacy_item_delete_photo_only_photo_is_409_not_materialized(
    client, db_session_factory, auth_headers
) -> None:
    iid, _ = _make_legacy_item(db_session_factory)
    r = client.delete(f"/items/{iid}/photos/1", headers=auth_headers)
    # The legacy cover is materialized in-request as photo id 1 (fresh DB),
    # so id 1 is found but is the item's only photo -> 409, then rolled back.
    assert r.status_code == 409
    assert r.json()["detail"] == "An item must keep at least one photo."
    s = db_session_factory()
    try:
        assert s.query(ItemPhoto).filter_by(item_id=iid).count() == 0
    finally:
        s.close()


def test_delete_photo_without_token_returns_401(client, db_session_factory, auth_headers) -> None:
    iid = _create(client, auth_headers, 2)
    photo_id = client.get(f"/items/{iid}", headers=auth_headers).json()["photos"][0]["id"]
    before = _uploads()
    r = client.delete(f"/items/{iid}/photos/{photo_id}")
    assert r.status_code == 401
    assert _uploads() == before


def test_save_upload_oserror_mid_write_removes_partial_file(
    client, auth_headers, monkeypatch
) -> None:
    real_open = Path.open

    class _FailingWriter:
        def __init__(self, f):
            self._f = f

        def __enter__(self):
            return self

        def __exit__(self, *a):
            self._f.close()
            return False

        def write(self, data):
            self._f.write(data[:1])
            raise OSError("disk full")

    def fake_open(self, mode="r", *a, **kw):
        f = real_open(self, mode, *a, **kw)
        return _FailingWriter(f) if mode == "wb" else f

    monkeypatch.setattr(Path, "open", fake_open)
    # Existing behavior for an unhandled OSError: it propagates (500 in prod).
    with pytest.raises(OSError, match="disk full"):
        client.post("/items", files=_files(1), headers=auth_headers)
    assert _uploads() == []


def test_delete_item_commit_failure_keeps_files(
    client, db_session_factory, auth_headers, monkeypatch
) -> None:
    from sqlalchemy.orm import Session

    iid = _create(client, auth_headers, 2)
    before = _uploads()
    assert len(before) == 2

    def boom(self):
        raise RuntimeError("commit failed")

    with monkeypatch.context() as m:
        m.setattr(Session, "commit", boom)
        with pytest.raises(RuntimeError, match="commit failed"):
            client.delete(f"/items/{iid}", headers=auth_headers)
    assert _uploads() == before
