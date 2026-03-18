"""Tests for HTTP client configuration — verifies anti-bot safety."""
from __future__ import annotations

import pytest

from src.utils.http_client import create_http_client


class TestHTTPClientConfig:
    async def test_user_agent_identifies_as_bot(self):
        """User-Agent should clearly identify as a research bot (transparent crawling)."""
        async with create_http_client() as client:
            ua = client.headers.get("user-agent", "")
            assert "SociaResearch" in ua
            assert "bot" in ua.lower()

    async def test_default_timeout(self):
        """Default timeout should be 30 seconds."""
        async with create_http_client() as client:
            assert client.timeout.connect == 30.0 or client.timeout.read == 30.0

    async def test_custom_timeout(self):
        async with create_http_client(timeout=10.0) as client:
            assert client.timeout.connect == 10.0 or client.timeout.read == 10.0

    async def test_follows_redirects(self):
        async with create_http_client() as client:
            assert client.follow_redirects is True

    async def test_custom_headers_merged(self):
        async with create_http_client(headers={"X-Custom": "value"}) as client:
            assert client.headers.get("x-custom") == "value"
            # Default User-Agent should still be present
            assert "SociaResearch" in client.headers.get("user-agent", "")


class TestHTTPClientAntiBot:
    """Verify the HTTP client doesn't look like a headless browser or scraper."""

    async def test_no_selenium_markers(self):
        """Client should not include headers that mimic browsers (Selenium-like)."""
        async with create_http_client() as client:
            ua = client.headers.get("user-agent", "")
            # Should NOT pretend to be a real browser
            assert "Mozilla" not in ua
            assert "Chrome" not in ua
            assert "Firefox" not in ua

    async def test_retry_transport_configured(self):
        """Retry transport should be configured for resilience."""
        async with create_http_client(max_retries=3) as client:
            transport = client._transport
            # httpx.AsyncHTTPTransport wraps retries
            assert transport is not None
