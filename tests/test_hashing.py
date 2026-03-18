"""Tests for URL canonicalization and content hashing."""
from __future__ import annotations

import pytest

from src.utils.hashing import canonicalize_url, content_hash


class TestCanonicalizeURL:
    def test_removes_utm_params(self):
        url = "https://example.com/post?utm_source=twitter&utm_medium=social"
        result = canonicalize_url(url)
        assert "utm_source" not in result
        assert "utm_medium" not in result

    def test_removes_fbclid(self):
        url = "https://example.com/post?fbclid=abc123&real_param=1"
        result = canonicalize_url(url)
        assert "fbclid" not in result
        assert "real_param=1" in result

    def test_removes_fragment(self):
        url = "https://example.com/post#section-2"
        result = canonicalize_url(url)
        assert "#" not in result

    def test_lowercases_scheme_and_host(self):
        url = "HTTPS://EXAMPLE.COM/Path"
        result = canonicalize_url(url)
        assert result.startswith("https://example.com/")
        # Path case should be preserved
        assert "/Path" in result

    def test_strips_trailing_slash(self):
        url = "https://example.com/post/"
        result = canonicalize_url(url)
        assert result.endswith("/post")

    def test_root_path_preserved(self):
        url = "https://example.com/"
        result = canonicalize_url(url)
        assert result.endswith("/")

    def test_preserves_non_tracking_params(self):
        url = "https://example.com/search?q=test&page=2"
        result = canonicalize_url(url)
        assert "q=test" in result
        assert "page=2" in result

    def test_same_url_different_tracking_same_canonical(self):
        url1 = "https://example.com/post?utm_source=twitter"
        url2 = "https://example.com/post?utm_source=facebook"
        assert canonicalize_url(url1) == canonicalize_url(url2)


class TestContentHash:
    def test_basic_hash(self):
        result = content_hash("Hello World")
        assert len(result) == 64  # SHA-256 hex

    def test_deterministic(self):
        assert content_hash("test") == content_hash("test")

    def test_whitespace_normalized(self):
        assert content_hash("hello  world") == content_hash("hello world")

    def test_case_insensitive(self):
        assert content_hash("HELLO") == content_hash("hello")

    def test_different_content_different_hash(self):
        assert content_hash("alpha") != content_hash("beta")
