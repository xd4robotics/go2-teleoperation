from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest

from app.config import Settings
from app.models import AuthContext, CurrentUser
from app.routers.robot import robot_status
from app.supabase_rest import SupabaseRestClient


def make_settings(service_key: str) -> Settings:
    return Settings(
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_public",
        supabase_service_role_key=service_key,
    )


def test_secret_key_is_never_sent_as_bearer_token() -> None:
    secret_key = "sb_secret_backend"
    headers = SupabaseRestClient(make_settings(secret_key))._headers(secret_key)

    assert headers["apikey"] == secret_key
    assert "Authorization" not in headers


def test_user_jwt_is_sent_with_publishable_key() -> None:
    headers = SupabaseRestClient(make_settings("service-role-jwt"))._headers("user-jwt")

    assert headers["apikey"] == "sb_publishable_public"
    assert headers["Authorization"] == "Bearer user-jwt"


@pytest.mark.asyncio
async def test_stale_telemetry_is_reported_offline() -> None:
    stale_timestamp = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()

    class FakeDatabase:
        async def select(self, *_args, **_kwargs):
            return [
                {
                    "robot_id": "primary",
                    "robot_online": True,
                    "network_online": True,
                    "sdk_connected": True,
                    "last_seen_at": stale_timestamp,
                }
            ]

    class FakeGateway:
        configured = False

    auth = AuthContext(
        user=CurrentUser(id=UUID("00000000-0000-0000-0000-000000000001")),
        access_token="user-jwt",
    )

    payload = await robot_status(auth, FakeDatabase(), FakeGateway())

    assert payload["robot_online"] is False
    assert payload["network_online"] is False
    assert payload["sdk_connected"] is False
