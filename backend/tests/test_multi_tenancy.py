"""Per-user isolation of items, photos and /uploads (sandbox-zp8.2)."""

from __future__ import annotations

import pytest

import app.main as main_module
from app.models import Item, ItemStatus
from tests.conftest import _make_jpeg_bytes

JPEG = _make_jpeg_bytes()
ALICE = "alice@example.com"
BOB = "bob@example.com"


@pytest.fixture()
def alice(auth_headers_for):
    return auth_headers_for(ALICE)


@pytest.fixture()
def bob(auth_headers_for):
    return auth_headers_for(BOB)


def _create(client, headers, n=2) -> dict:
    files = [("photos", (f"p{i}.jpg", JPEG, "image/jpeg")) for i in range(n)]
    r = client.post("/items", files=files, headers=headers)
    assert r.status_code == 201, r.text
    return client.get(f"/items/{r.json()['id']}", headers=headers).json()


def _missing_detail(client, headers, item_id) -> str:
    return client.get(f"/items/{item_id + 1000}", headers=headers).json()["detail"]


def test_created_item_carries_lowercased_owner(client, db_session_factory, auth_headers_for):
    item = _create(client, auth_headers_for("Alice@Example.COM "))
    s = db_session_factory()
    try:
        assert s.get(Item, item["id"]).owner_email == ALICE
    finally:
        s.close()


def test_list_isolation(client, alice, bob):
    a = _create(client, alice)
    b = _create(client, bob)
    assert [i["id"] for i in client.get("/items", headers=alice).json()] == [a["id"]]
    assert [i["id"] for i in client.get("/items", headers=bob).json()] == [b["id"]]
    for st in ItemStatus:
        ids = [i["id"] for i in client.get(f"/items?status={st.value}", headers=bob).json()]
        assert a["id"] not in ids


def test_mixed_case_session_email_sees_own_items(client, alice, auth_headers_for):
    a = _create(client, alice)
    upper = auth_headers_for("ALICE@example.com")
    assert client.get(f"/items/{a['id']}", headers=upper).status_code == 200


def test_per_item_endpoints_404_for_other_user(client, alice, bob):
    a = _create(client, alice)
    iid, pid = a["id"], a["photos"][0]["id"]
    missing = _missing_detail(client, bob, iid)
    files = [("photos", ("x.jpg", JPEG, "image/jpeg"))]
    responses = [
        client.get(f"/items/{iid}", headers=bob),
        client.patch(f"/items/{iid}/status", json={"status": "listed"}, headers=bob),
        client.delete(f"/items/{iid}", headers=bob),
        client.post(f"/items/{iid}/photos", files=files, headers=bob),
        client.delete(f"/items/{iid}/photos/{pid}", headers=bob),
    ]
    for r in responses:
        assert r.status_code == 404
        assert r.json()["detail"] == missing.replace(str(iid + 1000), str(iid))
    # Untouched for the owner.
    got = client.get(f"/items/{iid}", headers=alice).json()
    assert len(got["photos"]) == 2


def test_uploads_owner_200_other_404(client, alice, bob):
    a = _create(client, alice)
    url = a["photos"][1]["url"]
    assert client.get(url, headers=alice).status_code == 200
    assert client.get(url, headers=bob).status_code == 404
    assert client.get(url).status_code == 401


def test_uploads_unknown_file_404(client, alice):
    _create(client, alice)
    assert client.get("/uploads/nope.jpg", headers=alice).status_code == 404


def test_uploads_legacy_item_photo_path(client, db_session_factory, alice, bob):
    path = main_module.UPLOAD_DIR / "legacy.jpg"
    path.write_bytes(JPEG)
    s = db_session_factory()
    try:
        s.add(
            Item(
                photo_path=str(path),
                status=ItemStatus.PENDING_IDENTIFICATION,
                owner_email=ALICE,
            )
        )
        s.commit()
    finally:
        s.close()
    assert client.get("/uploads/legacy.jpg", headers=alice).status_code == 200
    assert client.get("/uploads/legacy.jpg", headers=bob).status_code == 404


def test_null_owner_item_invisible_to_everyone(client, db_session_factory, alice, bob):
    path = main_module.UPLOAD_DIR / "orphan.jpg"
    path.write_bytes(JPEG)
    s = db_session_factory()
    try:
        item = Item(photo_path=str(path), status=ItemStatus.DECIDED)
        s.add(item)
        s.commit()
        iid = item.id
    finally:
        s.close()
    for h in (alice, bob):
        assert client.get("/items", headers=h).json() == []
        assert client.get(f"/items/{iid}", headers=h).status_code == 404
        assert client.patch(
            f"/items/{iid}/status", json={"status": "listed"}, headers=h
        ).status_code == 404
        assert client.delete(f"/items/{iid}", headers=h).status_code == 404
        assert client.get("/uploads/orphan.jpg", headers=h).status_code == 404


@pytest.mark.parametrize("name", ["old.jpg", "we%ird_na me.jpg"])
def test_uploads_match_by_basename_when_stored_dir_differs(
    client, db_session_factory, alice, bob, name
):
    (main_module.UPLOAD_DIR / name).write_bytes(JPEG)
    s = db_session_factory()
    try:
        s.add(
            Item(
                photo_path=f"/old/data/uploads/{name}",
                status=ItemStatus.PENDING_IDENTIFICATION,
                owner_email=ALICE,
            )
        )
        s.commit()
    finally:
        s.close()
    url = "/uploads/" + name.replace("%", "%25").replace(" ", "%20")
    assert client.get(url, headers=alice).status_code == 200
    assert client.get(url, headers=bob).status_code == 404


def test_uploads_basename_via_item_photo_row_and_no_substring_match(
    client, db_session_factory, alice, bob
):
    from app.models import ItemPhoto

    (main_module.UPLOAD_DIR / "a.jpg").write_bytes(JPEG)
    (main_module.UPLOAD_DIR / "xa.jpg").write_bytes(JPEG)
    s = db_session_factory()
    try:
        item = Item(
            photo_path="C:\\old\\cover.jpg",
            status=ItemStatus.PENDING_IDENTIFICATION,
            owner_email=ALICE,
        )
        item.photos = [ItemPhoto(photo_path="C:\\old\\xa.jpg", position=0)]
        s.add(item)
        s.commit()
    finally:
        s.close()
    assert client.get("/uploads/xa.jpg", headers=alice).status_code == 200
    assert client.get("/uploads/xa.jpg", headers=bob).status_code == 404
    # "a.jpg" is only a suffix of "xa.jpg", not a basename match.
    assert client.get("/uploads/a.jpg", headers=alice).status_code == 404
