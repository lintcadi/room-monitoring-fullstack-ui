from zoneinfo import ZoneInfo

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Room Monitoring API"
    timezone: str = "Asia/Taipei"

    postgres_host: str
    postgres_port: int
    postgres_db: str
    postgres_user: str
    postgres_password: str

    redis_url: str = "redis://redis:6379/0"
    telemetry_poll_interval_seconds: float = Field(default=5, gt=0)

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )

    @property
    def timezone_info(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

settings = Settings()
