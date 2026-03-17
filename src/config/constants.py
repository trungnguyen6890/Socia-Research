from enum import Enum


class ConnectorType(str, Enum):
    RSS = "rss"
    WEBSITE = "website"
    YOUTUBE = "youtube"
    X_TWITTER = "x_twitter"
    TELEGRAM = "telegram"
    FACEBOOK_PAGE = "facebook_page"
    INSTAGRAM_PRO = "instagram_pro"
    FACEBOOK_PROFILE_WATCH = "facebook_profile_watch"
    TIKTOK_WATCH = "tiktok_watch"
    THREADS_WATCH = "threads_watch"


class SourceMode(str, Enum):
    OFFICIAL_API = "official_api"
    RSS = "rss"
    WEBSITE_PARSE = "website_parse"
    MANUAL_WATCH = "manual_watch"
    PROVIDER_API = "provider_api"


class RunStatus(str, Enum):
    SUCCESS = "success"
    ERROR = "error"
    PARTIAL = "partial"
    RUNNING = "running"


class MatchMode(str, Enum):
    EXACT = "exact"
    CONTAINS = "contains"
    REGEX = "regex"


# Watch-only connectors that don't support automated fetching
WATCH_ONLY_CONNECTORS = {
    ConnectorType.FACEBOOK_PROFILE_WATCH,
    ConnectorType.TIKTOK_WATCH,
    ConnectorType.THREADS_WATCH,
}
