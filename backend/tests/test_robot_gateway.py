from types import SimpleNamespace

import pytest

from app.config import Settings
from app.robot_gateway import RobotGatewayClient, RobotGatewayRejected
from app.routers.robot import normalize_gateway_status


def make_gateway() -> RobotGatewayClient:
    return RobotGatewayClient(
        Settings(
            robot_gateway_url="http://127.0.0.1:8081",
            robot_gateway_api_key="test-key",
        )
    )


@pytest.mark.asyncio
async def test_commands_are_mapped_to_gateway_routes(monkeypatch) -> None:
    gateway = make_gateway()
    calls = []

    async def fake_request(method, path, *, json=None):
        calls.append((method, path, json))
        return SimpleNamespace(json=lambda: {"ok": True})

    monkeypatch.setattr(gateway, "_request", fake_request)

    await gateway.execute(
        "move_analog",
        {"forward": 0.75, "lateral": -0.25, "yaw": 0.5},
    )
    await gateway.execute("forward")
    await gateway.execute("stand_up")
    await gateway.execute("recovery_stand")
    await gateway.execute("set_speed", {"percent": 35})
    await gateway.execute("set_obstacle_avoidance", {"enabled": False})
    await gateway.execute("damping")
    await gateway.execute("calibrate_docking_station")
    await gateway.execute("start_docking")
    await gateway.execute("cancel_docking")
    await gateway.execute("emergency_stop")

    assert calls == [
        (
            "POST",
            "/api/control/joystick",
            {"forward": 0.75, "lateral": -0.25, "yaw": 0.5},
        ),
        ("POST", "/api/control/move", {"command": "forward"}),
        ("POST", "/api/control/posture", {"command": "stand_up"}),
        ("POST", "/api/control/posture", {"command": "recovery_stand"}),
        ("POST", "/api/control/speed", {"percent": 35}),
        ("POST", "/api/control/obstacle-avoidance", {"enabled": False}),
        ("POST", "/api/control/damping", {}),
        ("POST", "/api/docking/calibrate", {}),
        ("POST", "/api/docking/start", {}),
        ("POST", "/api/docking/cancel", {}),
        ("POST", "/api/control/stop", {}),
    ]


@pytest.mark.asyncio
async def test_unknown_command_is_rejected() -> None:
    with pytest.raises(RobotGatewayRejected):
        await make_gateway().execute("dance")


@pytest.mark.asyncio
async def test_obstacle_avoidance_requires_boolean_state() -> None:
    with pytest.raises(RobotGatewayRejected):
        await make_gateway().execute(
            "set_obstacle_avoidance",
            {"enabled": "false"},
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"forward": 1.01, "lateral": 0, "yaw": 0},
        {"forward": 0, "lateral": float("nan"), "yaw": 0},
        {"forward": False, "lateral": 0, "yaw": 0},
    ],
)
async def test_analog_move_rejects_invalid_axes(payload) -> None:
    with pytest.raises(RobotGatewayRejected):
        await make_gateway().execute("move_analog", payload)


def test_gateway_status_is_normalized_for_frontend() -> None:
    payload = normalize_gateway_status(
        {
            "robot_connected": True,
            "camera_connected": True,
            "lio_connected": True,
            "control_armed": False,
            "point_count": 42,
        }
    )

    assert payload["robot_online"] is True
    assert payload["sdk_connected"] is True
    assert payload["gateway_connected"] is True
    assert payload["video_stream_url"] == "/api/robot/camera/frame"
    assert payload["map_data_url"] == "/api/robot/map/points"
