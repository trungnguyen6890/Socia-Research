from __future__ import annotations

import hashlib
import re
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode


def content_hash(text: str) -> str:
    """Generate SHA-256 hash of normalized text content."""
    normalized = re.sub(r"\s+", " ", text.strip().lower())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def canonicalize_url(url: str) -> str:
    """Normalize a URL by removing tracking params, fragments, and lowercasing."""
    parsed = urlparse(url)

    # Remove common tracking parameters
    tracking_params = {
        "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
        "fbclid", "gclid", "ref", "source", "mc_cid", "mc_eid",
    }
    query = parse_qs(parsed.query)
    filtered = {k: v for k, v in query.items() if k.lower() not in tracking_params}
    clean_query = urlencode(filtered, doseq=True)

    return urlunparse((
        parsed.scheme.lower(),
        parsed.netloc.lower(),
        parsed.path.rstrip("/") or "/",
        parsed.params,
        clean_query,
        "",  # Remove fragment
    ))
