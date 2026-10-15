from ipaddress import ip_address
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.dependencies import (
    get_auth_admin,
    get_auth_context,
    get_database,
    require_admin,
)
from app.models import (
    AdminUserCreateIn,
    AdminUserCreated,
    AuthContext,
    LoginEventIn,
)
from app.supabase_auth_admin import SupabaseAuthAdminClient
from app.supabase_rest import SupabaseRestClient


router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me")
async def me(auth: Annotated[AuthContext, Depends(get_auth_context)]) -> dict:
    return auth.user.model_dump(mode="json")


@router.post(
    "/users",
    response_model=AdminUserCreated,
    status_code=status.HTTP_201_CREATED,
)
async def create_user(
    payload: AdminUserCreateIn,
    _auth: Annotated[AuthContext, Depends(require_admin)],
    database: Annotated[SupabaseRestClient, Depends(get_database)],
    auth_admin: Annotated[SupabaseAuthAdminClient, Depends(get_auth_admin)],
) -> AdminUserCreated:
    email = payload.email.strip().lower()
    display_name = payload.display_name.strip() if payload.display_name else None
    created_user = await auth_admin.create_user(
        email=email,
        password=payload.password,
        display_name=display_name,
    )
    user_id = str(created_user["id"])

    try:
        profiles = await database.update(
            "profiles",
            database.settings.supabase_service_role_key,
            {
                "email": email,
                "display_name": display_name or email.split("@", 1)[0],
                "role": payload.role.value,
            },
            {"id": user_id},
        )
        if not profiles:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="O perfil do novo usuário não foi criado.",
            )
    except HTTPException:
        try:
            await auth_admin.delete_user(user_id)
        except HTTPException:
            pass
        raise

    profile = profiles[0]
    return AdminUserCreated(
        id=user_id,
        email=email,
        display_name=profile.get("display_name"),
        role=payload.role,
    )


@router.post("/login-events", status_code=status.HTTP_201_CREATED)
async def create_login_event(
    payload: LoginEventIn,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    database: Annotated[SupabaseRestClient, Depends(get_database)],
) -> dict[str, str]:
    forwarded_for = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    raw_ip = forwarded_for or (request.client.host if request.client else "")
    try:
        client_ip = str(ip_address(raw_ip)) if raw_ip else None
    except ValueError:
        client_ip = None
    await database.insert(
        "login_logs",
        auth.access_token,
        {
            "user_id": str(auth.user.id),
            "source": payload.source,
            "ip_address": client_ip,
            "user_agent": request.headers.get("user-agent", "")[:500],
        },
        return_representation=False,
    )
    return {"status": "recorded"}


@router.get("/login-events")
async def list_login_events(
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    database: Annotated[SupabaseRestClient, Depends(get_database)],
) -> list[dict]:
    return await database.select(
        "login_logs",
        auth.access_token,
        columns="id,source,logged_at",
        order="logged_at.desc",
        limit=50,
    )
