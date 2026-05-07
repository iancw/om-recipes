import io
import json
import types

import pytest


import sys
import types as pytypes


class _FakeFDKResponse:
    class Response:
        def __init__(self, ctx, response_data=None, headers=None, status_code=200):
            self.ctx = ctx
            self.body = response_data
            self.headers = headers or {}
            self.status_code = status_code


fdk_mod = pytypes.ModuleType("fdk")
fdk_mod.response = _FakeFDKResponse
sys.modules.setdefault("fdk", fdk_mod)

oci_mod = pytypes.ModuleType("oci")
oci_mod.auth = types.SimpleNamespace(
    signers=types.SimpleNamespace(get_resource_principals_signer=lambda: None)
)
oci_mod.object_storage = types.SimpleNamespace(ObjectStorageClient=lambda config, signer: None)
sys.modules.setdefault("oci", oci_mod)

wand_mod = pytypes.ModuleType("wand")
wand_image_mod = pytypes.ModuleType("wand.image")
wand_image_mod.Image = object
wand_mod.image = wand_image_mod
sys.modules.setdefault("wand", wand_mod)
sys.modules.setdefault("wand.image", wand_image_mod)


import func


def _mk_ctx():
    # fdk.response.Response only needs ctx to exist; handler doesn't read fields.
    return types.SimpleNamespace()


def test_parse_invocation_payload_accepts_manual_payload_with_override():
    src, obj, dst, is_batch = func.parse_invocation_payload(
        {"sourceBucket": "src-b", "objectName": "path/to/img.jpg", "destinationBucket": "dst-b"}
    )
    assert src == "src-b"
    assert obj == "path/to/img.jpg"
    assert dst == "dst-b"
    assert is_batch is False


def test_parse_invocation_payload_accepts_batch_manual_payload():
    src, objects, dst, is_batch = func.parse_invocation_payload(
        {
            "sourceBucket": "src-b",
            "objectNames": ["path/to/one.jpg", "nested/two.jpg"],
            "destinationBucket": "dst-b",
        }
    )
    assert src == "src-b"
    assert objects == ["path/to/one.jpg", "nested/two.jpg"]
    assert dst == "dst-b"
    assert is_batch is True


def test_parse_invocation_payload_rejects_batch_larger_than_limit():
    with pytest.raises(Exception, match="objectNames"):
        func.parse_invocation_payload(
            {
                "sourceBucket": "src-b",
                "objectNames": [f"img-{i}.jpg" for i in range(151)],
                "destinationBucket": "dst-b",
            }
        )


def test_parse_invocation_payload_accepts_legacy_event_payload():
    payload = {
        "data": {
            "resourceName": "p/q.jpg",
            "additionalDetails": {"bucketName": "legacy-src"},
        }
    }
    src, obj, dst, is_batch = func.parse_invocation_payload(payload)
    assert src == "legacy-src"
    assert obj == "p/q.jpg"
    assert dst is None
    assert is_batch is False


def test_parse_invocation_payload_accepts_event_payload_with_object_name_in_additional_details():
    payload = {
        "data": {
            "additionalDetails": {
                "bucketName": "legacy-src",
                "objectName": "nested/path.jpg",
            }
        }
    }
    src, obj, dst, is_batch = func.parse_invocation_payload(payload)
    assert src == "legacy-src"
    assert obj == "nested/path.jpg"
    assert dst is None
    assert is_batch is False


def test_parse_invocation_payload_rejects_invalid_payload_missing_required_fields():
    with pytest.raises(Exception):
        func.parse_invocation_payload({"destinationBucket": "only-dst"})


def test_variant_object_names_are_deterministic_on_repeat_runs():
    object_name = "authors/a/recipes/r/image.jpg"
    assert func._variant_object_name("640", object_name) == "640/authors/a/recipes/r/image.jpg"
    assert func._variant_object_name("640", object_name) == "640/authors/a/recipes/r/image.jpg"


def test_handler_manual_payload_uses_override_bucket_and_publishes_all_fixed_renditions(monkeypatch):
    monkeypatch.setenv("OCI_OBJECT_STORAGE_NAMESPACE", "ns")
    monkeypatch.setenv("OCI_DST_BUCKET", "env-dst")

    calls = {"download": None, "uploads": [], "resize": []}

    class FakeClient:
        pass

    def fake_client():
        return FakeClient()

    def fake_download(client, namespace, bucket, obj):
        calls["download"] = (namespace, bucket, obj)
        return b"original-bytes"

    def fake_resize(src_path, dst_path, max_dim=1200, quality=82):
        calls["resize"].append({"dst_path": dst_path, "max_dim": max_dim, "quality": quality})
        # write something so handler can read resized file
        with open(dst_path, "wb") as f:
            f.write(f"resized-{max_dim}".encode("utf-8"))

    def fake_upload(client, namespace, bucket, obj, content):
        calls["uploads"].append((namespace, bucket, obj, content))

    monkeypatch.setattr(func, "_object_storage_client", fake_client)
    monkeypatch.setattr(func, "_download_object", fake_download)
    monkeypatch.setattr(func, "_resize_jpeg", fake_resize)
    monkeypatch.setattr(func, "_upload_object", fake_upload)

    payload = {
        "sourceBucket": "src-b",
        "objectName": "authors/a/recipes/r/image.jpg",
        "destinationBucket": "manual-dst",
    }
    data = io.BytesIO(json.dumps(payload).encode("utf-8"))

    resp = func.handler(_mk_ctx(), data)

    body = json.loads(resp.body)
    assert body["ok"] is True
    assert calls["download"] == ("ns", "src-b", "authors/a/recipes/r/image.jpg")
    assert [r["max_dim"] for r in calls["resize"]] == [320, 640, 960, 1200, 1600]
    assert body["variantObjects"] == [
        "320/authors/a/recipes/r/image.jpg",
        "640/authors/a/recipes/r/image.jpg",
        "960/authors/a/recipes/r/image.jpg",
        "1200/authors/a/recipes/r/image.jpg",
        "1600/authors/a/recipes/r/image.jpg",
    ]

    assert len(calls["uploads"]) == 6
    for namespace, bucket, obj, content in calls["uploads"]:
        assert namespace == "ns"
        assert bucket == "manual-dst"
        if obj == "authors/a/recipes/r/image.jpg":
            assert content == b"original-bytes"
        elif obj == "320/authors/a/recipes/r/image.jpg":
            assert content == b"resized-320"
        elif obj == "640/authors/a/recipes/r/image.jpg":
            assert content == b"resized-640"
        elif obj == "960/authors/a/recipes/r/image.jpg":
            assert content == b"resized-960"
        elif obj == "1200/authors/a/recipes/r/image.jpg":
            assert content == b"resized-1200"
        elif obj == "1600/authors/a/recipes/r/image.jpg":
            assert content == b"resized-1600"
        else:
            raise AssertionError(f"Unexpected uploaded object name: {obj}")


def test_handler_batch_payload_copies_originals_and_continues_after_failure(monkeypatch):
    monkeypatch.setenv("OCI_OBJECT_STORAGE_NAMESPACE", "ns")
    monkeypatch.setenv("OCI_DST_BUCKET", "env-dst")

    calls = {"download": [], "uploads": [], "resize": []}

    class FakeClient:
        pass

    def fake_client():
        return FakeClient()

    def fake_download(client, namespace, bucket, obj):
        calls["download"].append((namespace, bucket, obj))
        if obj == "authors/a/recipes/r/two.jpg":
            raise Exception("missing source object")
        return f"original-{obj}".encode("utf-8")

    def fake_resize(src_path, dst_path, max_dim=1200, quality=82):
        calls["resize"].append({"dst_path": dst_path, "max_dim": max_dim, "quality": quality})
        with open(dst_path, "wb") as f:
            f.write(f"resized-{max_dim}".encode("utf-8"))

    def fake_upload(client, namespace, bucket, obj, content):
        calls["uploads"].append((namespace, bucket, obj, content))

    monkeypatch.setattr(func, "_object_storage_client", fake_client)
    monkeypatch.setattr(func, "_download_object", fake_download)
    monkeypatch.setattr(func, "_resize_jpeg", fake_resize)
    monkeypatch.setattr(func, "_upload_object", fake_upload)

    payload = {
        "sourceBucket": "src-b",
        "objectNames": [
            "authors/a/recipes/r/one.jpg",
            "authors/a/recipes/r/two.jpg",
        ],
        "destinationBucket": "manual-dst",
    }
    data = io.BytesIO(json.dumps(payload).encode("utf-8"))

    resp = func.handler(_mk_ctx(), data)

    body = json.loads(resp.body)
    assert body["ok"] is True
    assert body["processed"] == 2
    assert body["succeeded"] == 1
    assert body["failed"] == 1
    assert body["results"] == [
        {
            "objectName": "authors/a/recipes/r/one.jpg",
            "ok": True,
            "copiedOriginalObject": "authors/a/recipes/r/one.jpg",
            "variantObjects": [
                "320/authors/a/recipes/r/one.jpg",
                "640/authors/a/recipes/r/one.jpg",
                "960/authors/a/recipes/r/one.jpg",
                "1200/authors/a/recipes/r/one.jpg",
                "1600/authors/a/recipes/r/one.jpg",
            ],
        },
        {
            "objectName": "authors/a/recipes/r/two.jpg",
            "ok": False,
            "error": "missing source object",
        },
    ]

    assert calls["download"] == [
        ("ns", "src-b", "authors/a/recipes/r/one.jpg"),
        ("ns", "src-b", "authors/a/recipes/r/two.jpg"),
    ]
    assert len(calls["uploads"]) == 6
    assert calls["uploads"][0] == (
        "ns",
        "manual-dst",
        "authors/a/recipes/r/one.jpg",
        b"original-authors/a/recipes/r/one.jpg",
    )


def test_handler_empty_payload_returns_warm_response_without_oci_calls(monkeypatch):
    oci_called = {"value": False}

    def fake_client():
        oci_called["value"] = True
        raise AssertionError("OCI client should not be created for warm-up")

    monkeypatch.setattr(func, "_object_storage_client", fake_client)

    import io
    data = io.BytesIO(b"{}")
    resp = func.handler(_mk_ctx(), data)

    body = json.loads(resp.body)
    assert body["ok"] is True
    assert body["warm"] is True
    assert resp.status_code == 200
    assert not oci_called["value"]
