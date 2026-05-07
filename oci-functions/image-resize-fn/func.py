import io
import json
import os
import tempfile
import logging
from typing import Optional, Tuple

from fdk import response
import oci
from wand.image import Image


logger = logging.getLogger(__name__)
if not logger.handlers:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))

# Ordered so that the images that will be shown first are processed first
RENDITION_SPECS = [
    ("640", 640, 80),
    ("1200", 1200, 82),
    ("320", 320, 78),
    ("960", 960, 82),
    ("1600", 1600, 84),
]
MAX_BATCH_OBJECTS = 150


def _redact(obj):
    """Redact common secret-bearing keys in nested dict/list structures."""
    if isinstance(obj, dict):
        redacted = {}
        for k, v in obj.items():
            lk = str(k).lower()
            if lk in {"authorization", "cookie", "set-cookie", "token", "access_token", "id_token", "password", "secret", "api_key", "apikey"}:
                redacted[k] = "[REDACTED]"
            else:
                redacted[k] = _redact(v)
        return redacted
    if isinstance(obj, list):
        return [_redact(v) for v in obj]
    return obj


def _log_payload(payload: object, raw: str, max_bytes: int = 16_384):
    """Log event payload safely.

    - Prefers structured JSON when parseable
    - Redacts common secret keys
    - Limits output size to avoid huge logs
    """
    try:
        if isinstance(payload, dict) or isinstance(payload, list):
            safe = _redact(payload)
            s = json.dumps(safe, ensure_ascii=False)
        else:
            s = raw or ""
    except Exception:
        s = raw or ""

    truncated = s.encode("utf-8")
    if len(truncated) > max_bytes:
        s = truncated[:max_bytes].decode("utf-8", errors="replace") + "…[truncated]"
    logger.info("event payload: %s", s)


def _env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        raise Exception(f"Missing required env var {name}")
    return v


def _parse_object_create_event(payload: dict) -> Tuple[str, str]:
    """Parse OCI Events payload -> (bucketName, objectName)."""
    details = (payload or {}).get("data") or {}
    additional = details.get("additionalDetails") or {}
    bucket = additional.get("bucketName")
    obj = details.get("resourceName") or additional.get("objectName")
    if not bucket or not obj:
        raise Exception(
            "Unable to parse bucketName/objectName from event payload. "
            "Expected data.additionalDetails.bucketName and data.resourceName"
        )
    return bucket, obj


def _normalize_batch_object_names(object_names):
    if not isinstance(object_names, list) or not object_names:
        raise Exception("Unable to parse manual invocation payload. Expected non-empty objectNames array")

    normalized = []
    for object_name in object_names:
        if not isinstance(object_name, str) or not object_name.strip():
            raise Exception("Unable to parse manual invocation payload. objectNames must contain non-empty strings")
        normalized.append(object_name.strip())

    if len(normalized) > MAX_BATCH_OBJECTS:
        raise Exception(f"Unable to parse manual invocation payload. objectNames may contain at most {MAX_BATCH_OBJECTS} items")

    return normalized


def parse_invocation_payload(payload: object) -> Tuple[str, object, Optional[str], bool]:
    """Parse invocation payload.

    Supports:
    - Manual invocation: {"sourceBucket": "...", "objectName": "...", "destinationBucket": "..."?}
    - Batch manual invocation: {"sourceBucket": "...", "objectNames": ["..."], "destinationBucket": "..."?}
    - Legacy OCI Events payload: parses via _parse_object_create_event

    Returns (sourceBucket, objectName_or_objectNames, destinationBucketOverride, isBatch).
    """
    if isinstance(payload, dict):
        # Manual path: if any manual keys present, require sourceBucket + objectName
        if "sourceBucket" in payload or "objectName" in payload or "objectNames" in payload or "destinationBucket" in payload:
            src_bucket = payload.get("sourceBucket")
            object_name = payload.get("objectName")
            object_names = payload.get("objectNames")
            dst_bucket = payload.get("destinationBucket")
            if not src_bucket:
                raise Exception(
                    "Unable to parse manual invocation payload. Expected sourceBucket and objectName/objectNames"
                )
            if object_name and object_names:
                raise Exception(
                    "Unable to parse manual invocation payload. Provide either objectName or objectNames, not both"
                )
            if object_names is not None:
                return src_bucket, _normalize_batch_object_names(object_names), dst_bucket, True
            if not object_name:
                raise Exception(
                    "Unable to parse manual invocation payload. Expected sourceBucket and objectName/objectNames"
                )
            return src_bucket, object_name, dst_bucket, False

        # Legacy OCI Events payload
        src_bucket, object_name = _parse_object_create_event(payload)
        return src_bucket, object_name, None, False

    raise Exception("Unable to parse payload: expected JSON object")


def _object_storage_client():
    signer = oci.auth.signers.get_resource_principals_signer()
    return oci.object_storage.ObjectStorageClient(config={}, signer=signer)


def _download_object(client, namespace: str, bucket: str, obj: str) -> bytes:
    resp = client.get_object(namespace, bucket, obj)
    return resp.data.content


def _upload_object(client, namespace: str, bucket: str, obj: str, content: bytes):
    client.put_object(
        namespace_name=namespace,
        bucket_name=bucket,
        object_name=obj,
        put_object_body=content,
        content_type="image/jpeg",
        cache_control="public, max-age=31536000, immutable",
    )


def _variant_object_name(variant: str, object_name: str) -> str:
    # Store resized variants under explicit prefixes in the same bucket.
    # Example: 1200/authors/<...>/img.jpg
    return f"{variant}/{object_name.lstrip('/')}"


def _resize_jpeg(src_path: str, dst_path: str, max_dim: int = 1200, quality: int = 82):
    """Resize to max_dim on the long edge without upscaling."""
    with Image(filename=src_path) as img:
        img.auto_orient()
        if img.width >= img.height:
            if img.width > max_dim:
                img.transform(resize=f"{max_dim}x")
        else:
            if img.height > max_dim:
                img.transform(resize=f"x{max_dim}")

        img.format = "jpeg"
        img.compression_quality = quality
        img.interlace_scheme = "plane"
        img.save(filename=dst_path)


def publish_renditions(client, namespace: str, dst_bucket: str, object_name: str, original_bytes: bytes):
    with tempfile.TemporaryDirectory() as td:
        original_path = os.path.join(td, "original")
        with open(original_path, "wb") as f:
            f.write(original_bytes)

        published = []
        for variant, max_dim, quality in RENDITION_SPECS:
            output_path = os.path.join(td, f"resized-{variant}.jpg")
            logger.info('Processing variant %s for %s' % (variant, object_name))
            _resize_jpeg(original_path, output_path, max_dim=max_dim, quality=quality)
            with open(output_path, "rb") as f:
                _upload_object(
                    client,
                    namespace,
                    dst_bucket,
                    _variant_object_name(variant, object_name),
                    f.read(),
                )
            published.append(_variant_object_name(variant, object_name))

    return published


def publish_original_and_renditions(client, namespace: str, src_bucket: str, dst_bucket: str, object_name: str):
    logger.info('Processing original image %s from %s to %s' % (object_name, src_bucket, dst_bucket))
    original_bytes = _download_object(client, namespace, src_bucket, object_name)
    variant_objects = publish_renditions(client, namespace, dst_bucket, object_name, original_bytes)
    _upload_object(client, namespace, dst_bucket, object_name, original_bytes)

    return {
        "copiedOriginalObject": object_name,
        "variantObjects": variant_objects,
    }


def publish_batch(client, namespace: str, src_bucket: str, dst_bucket: str, object_names):
    results = []
    succeeded = 0
    failed = 0

    for object_name in object_names:
        try:
            published = publish_original_and_renditions(client, namespace, src_bucket, dst_bucket, object_name)
            results.append({
                "objectName": object_name,
                "ok": True,
                "copiedOriginalObject": published["copiedOriginalObject"],
                "variantObjects": published["variantObjects"],
            })
            succeeded += 1
        except Exception as err:
            logger.exception("Failed processing batch object %s", object_name)
            results.append({
                "objectName": object_name,
                "ok": False,
                "error": str(err),
            })
            failed += 1

    return {
        "ok": True,
        "sourceBucket": src_bucket,
        "destBucket": dst_bucket,
        "processed": len(object_names),
        "succeeded": succeeded,
        "failed": failed,
        "results": results,
    }


def handler(ctx, data: Optional[io.BytesIO] = None):
    try:
        raw = (data.getvalue().decode("utf-8") if data else "").strip() or "{}"
        payload = json.loads(raw)

        if payload == {}:
            logger.info("Invoked in warmup mode, returning with warm: true")
            return response.Response(
                ctx,
                response_data=json.dumps({"ok": True, "warm": True}),
                headers={"Content-Type": "application/json"},
            )

        _log_payload(payload, raw)

        src_bucket, object_name_or_names, dst_bucket_override, is_batch = parse_invocation_payload(payload)
        namespace = _env("OCI_OBJECT_STORAGE_NAMESPACE")
        dst_bucket = dst_bucket_override or _env("OCI_DST_BUCKET")

        logger.info("Running with namespace: %s, dest bucket: %s" % (namespace, dst_bucket))

        logger.info('Making object storage client...')
        client = _object_storage_client()
        logger.info('Publishing fixed renditions...')

        if is_batch:
            logger.info('Running in batch mode with %d objects' % (len(object_name_or_names)))
            response_body = publish_batch(client, namespace, src_bucket, dst_bucket, object_name_or_names)
        else:
            object_name = object_name_or_names
            published = publish_original_and_renditions(client, namespace, src_bucket, dst_bucket, object_name)
            response_body = {
                "ok": True,
                "sourceBucket": src_bucket,
                "destBucket": dst_bucket,
                "objectName": object_name,
                "copiedOriginalObject": published["copiedOriginalObject"],
                "variantObjects": published["variantObjects"],
            }

        logger.info('Returning response...')
        logger.info(json.dumps(response_body))
        return response.Response(
            ctx,
            response_data=json.dumps(response_body),
            headers={"Content-Type": "application/json"},
        )
    except Exception as e:
        logger.error(e)
        return response.Response(
            ctx,
            response_data=json.dumps({"ok": False, "error": str(e)}),
            headers={"Content-Type": "application/json"},
            status_code=500,
        )
