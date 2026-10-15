from fastapi import APIRouter, Depends

from app.config import Settings, get_settings


router = APIRouter(tags=["health"])


@router.get("/health")
async def health(settings: Settings = Depends(get_settings)) -> dict[str, str | bool]:
    return {
        "status": "ok",
        "environment": settings.app_env,
        "supabase_configured": settings.supabase_configured,
    }
