from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel
from pydantic_settings import BaseSettings


CONFIG_DIR = Path(__file__).resolve().parent.parent.parent / "config"
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class RateLimitConfig(BaseModel):
    requests_per_window: int = 60
    window_seconds: int = 60


class DatabaseConfig(BaseModel):
    url: str = "sqlite+aiosqlite:///data/socia.db"


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8000


class SchedulerConfig(BaseModel):
    default_interval_minutes: int = 30


class LoggingConfig(BaseModel):
    level: str = "INFO"
    format: str = "json"


class Settings(BaseSettings):
    database: DatabaseConfig = DatabaseConfig()
    server: ServerConfig = ServerConfig()
    scheduler: SchedulerConfig = SchedulerConfig()
    logging: LoggingConfig = LoggingConfig()
    rate_limits: dict[str, RateLimitConfig] = {}
    connectors: dict[str, dict[str, str]] = {}

    # API keys loaded from environment
    youtube_api_key: str = ""
    x_bearer_token: str = ""
    telegram_api_id: str = ""
    telegram_api_hash: str = ""
    fb_access_token: str = ""
    ig_access_token: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


def load_settings(config_path: Path | None = None) -> Settings:
    """Load settings from YAML file and environment variables."""
    path = config_path or CONFIG_DIR / "settings.yaml"

    yaml_data: dict[str, Any] = {}
    if path.exists():
        with open(path) as f:
            yaml_data = yaml.safe_load(f) or {}

    return Settings(**yaml_data)


# Singleton
_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = load_settings()
    return _settings
