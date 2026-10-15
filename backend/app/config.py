from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    app_name: str = "XD4 Robotics API"
    api_prefix: str = "/api"
    cors_origins: str = "http://localhost:5173"

    supabase_url: str = ""
    supabase_publishable_key: str = ""
    supabase_service_role_key: str = ""
    integration_api_key: str = ""

    # Quando preenchido, o FastAPI encaminha comandos e sensores diretamente
    # ao gateway ROS executado na Jetson. Sem essa URL, permanece no modo fila.
    robot_gateway_url: str = ""
    robot_gateway_api_key: str = ""
    robot_gateway_timeout_seconds: float = 3.0

    oracle_api_url: str = ""
    oracle_api_key: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def allowed_origins(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.cors_origins.split(",")
            if origin.strip()
        ]

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_publishable_key)

    @property
    def direct_robot_configured(self) -> bool:
        return bool(self.robot_gateway_url.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
