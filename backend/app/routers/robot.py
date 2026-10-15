from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.dependencies import get_auth_context, get_database, get_robot_gateway
from app.models import AuthContext, RobotAudioIn, RobotCommandIn
from app.robot_gateway import (
    RobotGatewayClient,
    RobotGatewayRejected,
    RobotGatewayUnavailable,
)
from app.supabase_rest import SupabaseRestClient


router = APIRouter(prefix="/robot", tags=["robot"])


OFFLINE_STATUS = {
    "robot_id": "primary",
    "robot_online": False,
    "network_online": False,
    "sdk_connected": False,
    "battery_connected": False,
    "battery_percent": None,
    "battery_voltage_v": None,
    "battery_current_a": None,
    "robot_temperature_c": None,
    "robot_temperature_average_c": None,
    "robot_temperature_high": False,
    "robot_temperature_high_threshold_c": 70,
    "charging": False,
    "autonomy_minutes": None,
    "current_speed_mps": 0.0,
    "robot_activity_status": "stopped",
    "aruco_available": False,
    "docking_station_calibrated": False,
    "docking_station_calibrated_at": None,
    "docking_station_point_count": 0,
    "docking_station_marker_calibrated": False,
    "docking_calibration_ready": False,
    "docking_marker_visible": False,
    "docking_marker_matches_station": False,
    "docking_active": False,
    "docking_state": "unavailable",
    "docking_message": None,
    "docking_error": None,
    "docking_distance_m": None,
    "docking_adjustment_count": 0,
    "docking_next_adjustment_seconds": None,
    "video_stream_url": None,
    "map_data_url": None,
    "last_seen_at": None,
    "telemetry": {},
    "gateway_connected": False,
    "camera_connected": False,
    "lio_connected": False,
    "control_armed": False,
    "posture": "unknown",
    "point_count": 0,
    "current_location": None,
    "speed_limit_percent": 100,
    "speed_min_percent": 10,
    "speed_max_percent": 100,
    "speed_step_percent": 10,
    "obstacle_avoidance_enabled": False,
    "obstacle_avoidance_requested": False,
    "obstacle_avoidance_state_confirmed": False,
    "obstacle_avoidance_command_ready": False,
    "native_avoidance_switch": None,
    "safety_mode": "unitree_native_obstacles_avoid",
    "safety_ready": False,
    "remote_source_operational": False,
    "safety_blocked": False,
}


def normalize_gateway_status(payload: dict) -> dict:
    robot_online = bool(payload.get("robot_connected"))
    camera_connected = bool(payload.get("camera_connected"))
    lio_connected = bool(payload.get("lio_connected"))
    return {
        **OFFLINE_STATUS,
        **payload,
        "robot_id": "primary",
        "robot_online": robot_online,
        "network_online": True,
        "sdk_connected": robot_online,
        "gateway_connected": True,
        "camera_connected": camera_connected,
        "lio_connected": lio_connected,
        "video_stream_url": (
            "/api/robot/camera/frame" if camera_connected else None
        ),
        "map_data_url": "/api/robot/map/points" if lio_connected else None,
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
        "telemetry": payload,
    }


def gateway_http_error(error: Exception) -> HTTPException:
    if isinstance(error, RobotGatewayRejected):
        code = error.status_code if 400 <= error.status_code < 500 else 502
        return HTTPException(status_code=code, detail=str(error))
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=str(error),
    )


@router.get("/status")
async def robot_status(
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    database: Annotated[SupabaseRestClient, Depends(get_database)],
    gateway: Annotated[RobotGatewayClient, Depends(get_robot_gateway)],
) -> dict:
    if gateway.configured:
        try:
            return normalize_gateway_status(await gateway.status())
        except (RobotGatewayUnavailable, RobotGatewayRejected) as error:
            return {
                **OFFLINE_STATUS,
                "gateway_error": str(error),
            }

    rows = await database.select(
        "robot_status",
        auth.access_token,
        filters={"robot_id": "primary"},
        limit=1,
    )
    if not rows:
        return OFFLINE_STATUS

    current_status = rows[0]
    last_seen_at = current_status.get("last_seen_at")
    if last_seen_at:
        last_seen = datetime.fromisoformat(last_seen_at.replace("Z", "+00:00"))
        if datetime.now(timezone.utc) - last_seen > timedelta(seconds=30):
            current_status.update(
                robot_online=False,
                network_online=False,
                sdk_connected=False,
            )
    return {**OFFLINE_STATUS, **current_status}


@router.get("/map/points")
async def robot_map_points(
    _auth: Annotated[AuthContext, Depends(get_auth_context)],
    gateway: Annotated[RobotGatewayClient, Depends(get_robot_gateway)],
) -> dict:
    try:
        return await gateway.map_points()
    except (RobotGatewayUnavailable, RobotGatewayRejected) as error:
        raise gateway_http_error(error) from error


@router.get("/camera/frame")
async def robot_camera_frame(
    _auth: Annotated[AuthContext, Depends(get_auth_context)],
    gateway: Annotated[RobotGatewayClient, Depends(get_robot_gateway)],
) -> Response:
    try:
        content, media_type = await gateway.camera_frame()
    except (RobotGatewayUnavailable, RobotGatewayRejected) as error:
        raise gateway_http_error(error) from error
    return Response(
        content=content,
        media_type=media_type,
        headers={"Cache-Control": "no-store"},
    )


@router.post("/audio/megaphone")
async def robot_audio_megaphone(
    payload: RobotAudioIn,
    _auth: Annotated[AuthContext, Depends(get_auth_context)],
    gateway: Annotated[RobotGatewayClient, Depends(get_robot_gateway)],
) -> dict:
    try:
        return await gateway.audio_megaphone(
            payload.action,
            data=payload.data,
            current_block_index=payload.current_block_index,
            total_block_number=payload.total_block_number,
            delay_seconds=payload.delay_seconds,
        )
    except (RobotGatewayUnavailable, RobotGatewayRejected) as error:
        raise gateway_http_error(error) from error


@router.post("/commands", status_code=status.HTTP_202_ACCEPTED)
async def queue_command(
    payload: RobotCommandIn,
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    database: Annotated[SupabaseRestClient, Depends(get_database)],
    gateway: Annotated[RobotGatewayClient, Depends(get_robot_gateway)],
) -> dict:
    safety_commands = {"stop", "emergency_stop", "damping", "disarm"}
    low_battery_allowed_commands = safety_commands | {
        "calibrate_docking_station",
        "start_docking",
        "cancel_docking",
    }

    if gateway.configured:
        try:
            direct_status = normalize_gateway_status(await gateway.status())
            if (
                payload.command.value not in safety_commands
                and not direct_status["sdk_connected"]
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="O SDK do robô está desconectado.",
                )
            battery = direct_status.get("battery_percent")
            if (
                payload.command.value not in low_battery_allowed_commands
                and battery is not None
                and battery <= 5
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Comando bloqueado: bateria em nível crítico.",
                )
            result = await gateway.execute(
                payload.command.value,
                payload.payload,
            )
        except HTTPException:
            raise
        except (RobotGatewayUnavailable, RobotGatewayRejected) as error:
            raise gateway_http_error(error) from error
        return {
            "id": None,
            "robot_id": payload.robot_id,
            "command": payload.command.value,
            "status": "completed",
            "transport": "direct_gateway",
            "result": result,
        }

    status_rows = await database.select(
        "robot_status",
        auth.access_token,
        filters={"robot_id": payload.robot_id},
        limit=1,
    )
    current_status = status_rows[0] if status_rows else OFFLINE_STATUS
    if (
        payload.command.value not in safety_commands
        and not current_status["sdk_connected"]
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="O SDK do robô está desconectado.",
        )
    battery = current_status.get("battery_percent")
    if (
        payload.command.value not in low_battery_allowed_commands
        and battery is not None
        and battery <= 5
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Comando bloqueado: bateria em nível crítico (5% ou menos).",
        )

    rows = await database.insert(
        "robot_commands",
        auth.access_token,
        {
            "user_id": str(auth.user.id),
            "robot_id": payload.robot_id,
            "command": payload.command.value,
            "payload": payload.payload,
        },
    )
    return rows[0]
