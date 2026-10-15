from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.dependencies import get_auth_context, get_database
from app.models import AuthContext, OracleAnalysisIn
from app.supabase_rest import SupabaseRestClient


router = APIRouter(prefix="/oracle", tags=["oracle"])


@router.post("/analyses", status_code=status.HTTP_202_ACCEPTED)
async def queue_analysis(
    payload: OracleAnalysisIn,
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    database: Annotated[SupabaseRestClient, Depends(get_database)],
) -> dict:
    rows = await database.insert(
        "oracle_analyses",
        auth.access_token,
        {
            "user_id": str(auth.user.id),
            "robot_id": payload.robot_id,
            "image_url": payload.image_url,
            "metadata": payload.metadata,
        },
    )
    return rows[0]


@router.get("/analyses")
async def list_analyses(
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    database: Annotated[SupabaseRestClient, Depends(get_database)],
) -> list[dict]:
    return await database.select(
        "oracle_analyses",
        auth.access_token,
        filters={"user_id": str(auth.user.id)},
        order="created_at.desc",
        limit=20,
    )
