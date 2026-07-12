"""
pinterest_post_pins.py

Full posting pipeline: generate pin image -> upload to R2 (public URL,
since Pinterest's API requires one) -> create the Pin via Pinterest API
v5 -> track posting state for pacing enforcement.

Pacing rules established earlier: 15-50 pins/day, no repeat destination
URL within 72 hours. State is tracked in Upstash Redis (same service
already used elsewhere in this project) so pacing persists correctly
across separate scheduled runs, not just within a single script execution.

Required env vars:
  PINTEREST_ACCESS_TOKEN
  CF_R2_ENDPOINT, CF_R2_ACCESS_KEY, CF_R2_SECRET_KEY, CF_R2_BUCKET, CF_R2_PUBLIC_URL
  KV_REST_API_URL, KV_REST_API_TOKEN (Upstash Redis, same as used elsewhere)
"""

import os
import sys
import time
import json
import hmac
import hashlib
import urllib.request
import urllib.error
from datetime import datetime, timezone

PINTEREST_API_BASE = "https://api.pinterest.com/v5"

# Pacing rules from the Pinterest strategy work
MIN_PINS_PER_DAY = 15
MAX_PINS_PER_DAY = 50
SAME_URL_SPACING_HOURS = 72


# ─── Redis (Upstash) -- for pacing state, same service used elsewhere ──────
def _redis_env():
    url = os.environ.get("KV_REST_API_URL")
    token = os.environ.get("KV_REST_API_TOKEN")
    if not url or not token:
        print("WARNING: KV_REST_API_URL/KV_REST_API_TOKEN not set -- pacing "
              "state won't persist across runs. Set these before relying on "
              "this for real scheduled posting.")
    return url, token


def redis_get(key: str):
    url, token = _redis_env()
    if not url:
        return None
    req = urllib.request.Request(f"{url}/get/{key}", headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read())
            return data.get("result")
    except Exception:
        return None


def redis_set(key: str, value: str, ttl_seconds: int = None):
    url, token = _redis_env()
    if not url:
        return
    path = f"/setex/{key}/{ttl_seconds}/{value}" if ttl_seconds else f"/set/{key}/{value}"
    req = urllib.request.Request(f"{url}{path}", method="POST",
                                   headers={"Authorization": f"Bearer {token}"})
    try:
        urllib.request.urlopen(req, timeout=5)
    except Exception as e:
        print(f"  WARNING: Redis write failed for {key}: {e}")


# ─── Pacing checks ──────────────────────────────────────────────────────────
def check_daily_count() -> int:
    """Returns how many pins have already been posted today (UTC)."""
    today_key = f"pinterest:daily_count:{datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    count = redis_get(today_key)
    return int(count) if count else 0


def increment_daily_count():
    today_key = f"pinterest:daily_count:{datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    current = check_daily_count()
    # 26h TTL -- comfortably covers a full day even with minor scheduling
    # drift, without accumulating stale keys forever
    redis_set(today_key, str(current + 1), ttl_seconds=26 * 60 * 60)


def check_url_spacing(destination_url: str) -> bool:
    """
    Returns True if this URL is safe to pin again (hasn't been pinned in
    the last SAME_URL_SPACING_HOURS), False if it should be skipped.
    """
    key = f"pinterest:last_pinned:{destination_url}"
    last_pinned = redis_get(key)
    if not last_pinned:
        return True
    elapsed_hours = (time.time() - float(last_pinned)) / 3600
    return elapsed_hours >= SAME_URL_SPACING_HOURS


def record_url_pinned(destination_url: str):
    key = f"pinterest:last_pinned:{destination_url}"
    redis_set(key, str(time.time()), ttl_seconds=SAME_URL_SPACING_HOURS * 60 * 60 + 3600)


# ─── R2 upload (Python port of api/giveaway/upload.js's signing logic) ─────
def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def _sha256hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def upload_to_r2(local_path: str, r2_key: str) -> str:
    """
    Uploads a local file to R2 using AWS Signature V4, same signing
    approach as api/giveaway/upload.js (ported to Python here since this
    runs as a standalone script, not through that authenticated endpoint).
    Returns the public URL.
    """
    endpoint = os.environ["CF_R2_ENDPOINT"]
    access_key = os.environ["CF_R2_ACCESS_KEY"]
    secret_key = os.environ["CF_R2_SECRET_KEY"]
    bucket = os.environ["CF_R2_BUCKET"]
    public_url = os.environ["CF_R2_PUBLIC_URL"]

    with open(local_path, "rb") as f:
        body = f.read()
    content_type = "image/png"

    url = f"{endpoint}/{bucket}/{r2_key}"
    host = url.split("://")[1].split("/")[0]
    now = datetime.now(timezone.utc)
    date_stamp = now.strftime("%Y%m%d")
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    region, service = "auto", "s3"

    payload_hash = _sha256hex(body)
    canonical_headers = (
        f"content-type:{content_type}\nhost:{host}\n"
        f"x-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    )
    signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join([
        "PUT", f"/{bucket}/{r2_key}", "", canonical_headers, signed_headers, payload_hash,
    ])

    credential_scope = f"{date_stamp}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amz_date, credential_scope, _sha256hex(canonical_request.encode()),
    ])

    k_date = _sign(("AWS4" + secret_key).encode(), date_stamp)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, service)
    signing_key = _sign(k_service, "aws4_request")
    signature = hmac.new(signing_key, string_to_sign.encode(), hashlib.sha256).hexdigest()

    authorization = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    req = urllib.request.Request(url, data=body, method="PUT", headers={
        "Content-Type": content_type,
        "Authorization": authorization,
        "x-amz-date": amz_date,
        "x-amz-content-sha256": payload_hash,
    })
    with urllib.request.urlopen(req, timeout=30) as response:
        if response.status not in (200, 201):
            raise RuntimeError(f"R2 upload failed: {response.status}")

    return f"{public_url.rstrip('/')}/{r2_key}"


# ─── Pinterest pin creation ─────────────────────────────────────────────────
def create_pin(board_id: str, image_url: str, title: str, description: str,
                destination_url: str, alt_text: str) -> dict:
    token = os.environ["PINTEREST_ACCESS_TOKEN"]
    payload = {
        "board_id": board_id,
        "media_source": {
            "source_type": "image_url",
            "url": image_url,
        },
        "title": title[:100],        # Pinterest's title length limit
        "description": description[:500],
        "link": destination_url,
        "alt_text": alt_text[:500],
    }
    req = urllib.request.Request(
        f"{PINTEREST_API_BASE}/pins",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        raise RuntimeError(f"Pinterest API {e.code}: {body}")


# ─── Full pipeline for one pin ──────────────────────────────────────────────
def post_one_pin(local_image_path: str, board_id: str, title: str,
                  description: str, destination_url: str, alt_text: str) -> bool:
    """
    Returns True if the pin was posted, False if it was skipped due to
    pacing rules (not an error -- this is expected/normal behavior).
    """
    daily_count = check_daily_count()
    if daily_count >= MAX_PINS_PER_DAY:
        print(f"  Skipped: already at daily max ({daily_count}/{MAX_PINS_PER_DAY})")
        return False

    if not check_url_spacing(destination_url):
        print(f"  Skipped: {destination_url} was pinned within the last "
              f"{SAME_URL_SPACING_HOURS}h -- spacing rule")
        return False

    r2_key = f"pinterest-pins/{int(time.time())}_{os.path.basename(local_image_path)}"
    image_url = upload_to_r2(local_image_path, r2_key)
    print(f"  Uploaded to R2: {image_url}")

    result = create_pin(board_id, image_url, title, description, destination_url, alt_text)
    pin_id = result.get("id")
    print(f"  Pin created: {pin_id}")

    increment_daily_count()
    record_url_pinned(destination_url)
    return True


if __name__ == "__main__":
    print("This module is meant to be imported and driven by a per-set pin "
          "campaign script, not run standalone -- see pinterest_campaign.py "
          "for an example of building the actual pin list and calling "
          "post_one_pin() for each.")
