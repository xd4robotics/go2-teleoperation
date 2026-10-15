from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.dependencies import get_database, require_integration_key
from app.models import CommandResultIn, RobotTelemetryIn
from app.supabase_rest import SupabaseRestClient


router = APIRouter(prefix="/integrations", tags=["integrations"])


@router.post("/telemetry")
async def publish_telemetry(
    payload: RobotTelemetryIn,
    service_token: Annotated[str, Depends(require_integration_key)],
    database: Annotated[SupabaseRestClient, Depends(get_database)],
) -> dict:
    rows = await database.upsert(
        "robot_status",
        service_token,
        {
            **payload.model_dump(mode="json"),
            "last_seen_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="robot_id",
    )
    return rows[0]


@router.get("/commands")
async def pending_commands(
    service_token: Annotated[str, Depends(require_integration_key)],
    database: Annotated[SupabaseRestClient, Depends(get_database)],
    robot_id: str = Query(default="primary", min_length=1, max_length=80),
) -> list[dict]:
    return await database.select(
        "robot_commands",
        service_token,
        filters={"robot_id": robot_id, "status": "queued"},
        order="created_at.asc",
        limit=25,
    )


@router.patch("/commands/{command_id}")
async def update_command(
    command_id: UUID,
    payload: CommandResultIn,
    service_token: Annotated[str, Depends(require_integration_key)],
    database: Annotated[SupabaseRestClient, Depends(get_database)],
) -> dict:
    updates = payload.model_dump(mode="json")
    if payload.status in {"completed", "failed"}:
        updates["processed_at"] = datetime.now(timezone.utc).isoformat()
    rows = await database.update(
        "robot_commands",
        service_token,
        updates,
        {"id": str(command_id)},
    )
    return rows[0]


@router.get("/oracle-analyses")
async def pending_oracle_analyses(
    service_token: Annotated[str, Depends(require_integration_key)],
    database: Annotated[SupabaseRestClient, Depends(get_database)],
) -> list[dict]:
    return await database.select(
        "oracle_analyses",
        service_token,
        filters={"status": "queued"},
        order="created_at.asc",
        limit=25,
    )


@router.patch("/oracle-analyses/{analysis_id}")
async def update_oracle_analysis(
    analysis_id: UUID,
    payload: CommandResultIn,
    service_token: Annotated[str, Depends(require_integration_key)],
    database: Annotated[SupabaseRestClient, Depends(get_database)],
) -> dict:
    updates = payload.model_dump(mode="json")
    if payload.status in {"completed", "failed"}:
        updates["completed_at"] = datetime.now(timezone.utc).isoformat()
    rows = await database.update(
        "oracle_analyses",
        service_token,
        updates,
        {"id": str(analysis_id)},
    )
    return rows[0]
