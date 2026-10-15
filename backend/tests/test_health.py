import pytest

from app.config import get_settings
from app.main import app
from app.routers.health import health


@pytest.mark.asyncio
async def test_health_endpoint() -> None:
    payload = await health(get_settings())

    assert payload["status"] == "ok"


def test_expected_routes_are_registered() -> None:
    paths = app.openapi()["paths"]

    assert "/health" in paths
    assert "/api/auth/me" in paths
    assert "/api/auth/users" in paths
    assert "/api/auth/login-events" in paths
    assert "/api/robot/commands" in paths
    assert "/api/robot/map/points" in paths
    assert "/api/robot/camera/frame" in paths
    assert "/api/oracle/analyses" in paths
    assert "/api/integrations/telemetry" in paths
    assert "/api/integrations/oracle-analyses" in paths
