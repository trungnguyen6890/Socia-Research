from __future__ import annotations

import httpx


def create_http_client(
    timeout: float = 30.0,
    max_retries: int = 3,
    headers: dict[str, str] | None = None,
) -> httpx.AsyncClient:
    """Create a shared async HTTP client with retry transport."""
    transport = httpx.AsyncHTTPTransport(retries=max_retries)
    default_headers = {
        "User-Agent": "SociaResearch/0.1 (research bot)",
    }
    if headers:
        default_headers.update(headers)

    return httpx.AsyncClient(
        transport=transport,
        timeout=httpx.Timeout(timeout),
        headers=default_headers,
        follow_redirects=True,
    )
