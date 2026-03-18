from __future__ import annotations

from typing import Any
from urllib.parse import urljoin

from selectolax.parser import HTMLParser

from src.config.constants import ConnectorType
from src.connectors.base import BaseConnector, ContentItemCreate, FetchResult
from src.connectors.registry import register_connector
from src.utils.hashing import canonicalize_url


@register_connector(ConnectorType.WEBSITE)
class WebsiteConnector(BaseConnector):
    """Generic website parser using CSS selectors from source config.

    Expected source.config keys:
        - item_selector: CSS selector for each content item container
        - title_selector: CSS selector for title within item (optional)
        - link_selector: CSS selector for link within item (optional)
        - text_selector: CSS selector for text within item (optional)
        - time_selector: CSS selector for publish time within item (optional)
    """

    connector_type = ConnectorType.WEBSITE

    async def fetch(self, since_cursor: str | None = None) -> FetchResult:
        await self.rate_limiter.acquire(self.connector_type)

        url = self.source.url_or_handle
        response = await self.http.get(url)
        response.raise_for_status()

        tree = HTMLParser(response.text)
        item_selector = self.config.get("item_selector", "article")
        items_nodes = tree.css(item_selector)

        seen_urls: set[str] = set()
        if since_cursor:
            seen_urls.add(since_cursor)

        raw_items = []
        latest_url: str | None = None

        for node in items_nodes:
            item = self._extract_item(node, url)
            item_url = item.get("link", "")

            if item_url in seen_urls:
                continue

            if latest_url is None and item_url:
                latest_url = item_url

            raw_items.append(item)

        return FetchResult(
            raw_items=raw_items,
            new_cursor=latest_url or since_cursor,
            metadata={"page_url": url, "items_found": len(raw_items)},
        )

    def normalize(self, raw_item: dict[str, Any]) -> ContentItemCreate:
        url = raw_item.get("link", "")
        return ContentItemCreate(
            url=url,
            canonical_url=canonicalize_url(url) if url else None,
            connector_type=self.connector_type,
            title=raw_item.get("title"),
            text_content=raw_item.get("text"),
            publish_time=raw_item.get("time"),
            engagement_snapshot=None,
            raw_data=raw_item,
            content_type="article",
            has_media=False,
        )

    def _extract_item(self, node: Any, base_url: str) -> dict[str, Any]:
        """Extract fields from a DOM node using configured selectors."""
        title = self._select_text(node, self.config.get("title_selector", "h2, h3, .title"))
        link = self._select_attr(node, self.config.get("link_selector", "a"), "href")
        text = self._select_text(node, self.config.get("text_selector", "p, .summary, .excerpt"))
        time_str = self._select_text(node, self.config.get("time_selector", "time, .date"))

        if link and not link.startswith("http"):
            link = urljoin(base_url, link)

        return {"title": title, "link": link or "", "text": text, "time": time_str}

    @staticmethod
    def _select_text(node: Any, selector: str) -> str | None:
        el = node.css_first(selector)
        return el.text(strip=True) if el else None

    @staticmethod
    def _select_attr(node: Any, selector: str, attr: str) -> str | None:
        el = node.css_first(selector)
        if el is None:
            return None
        return el.attributes.get(attr)
