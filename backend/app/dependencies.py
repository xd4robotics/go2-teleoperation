import hmac
import hashlib
import time
from typing import Annotated

import httpx
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings, get_settings
from app.models import AuthContext, CurrentUser, UserRole
from app.robot_gateway import RobotGatewayClient
from app.supabase_auth_admin import SupabaseAuthAdminClient
from app.supabase_rest import SupabaseRestClient


bearer_scheme = HTTPBearer(auto_error=False)
_AUTH_CACHE_TTL_SECONDS = 20.0
_auth_cache: dict[str, tuple[float, CurrentUser]] = {}


async def get_auth_context(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AuthContext:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sessão necessária.",
        )
    if not settings.supabase_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase ainda não foi configurado no backend.",
        )

    token = credentials.credentials
    token_digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    cached = _auth_cache.get(token_digest)
    if cached and time.monotonic() - cached[0] < _AUTH_CACHE_TTL_SECONDS:
        return AuthContext(user=cached[1], access_token=token)

    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/user"
    headers = {
        "apikey": settings.supabase_publishable_key,
        "Authorization": f"Bearer {token}",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.get(url, headers=headers)
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Não foi possível validar a sessão.",
            ) from exc

    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sessão inválida.",
        )

    payload = response.json()
    profile_rows = await SupabaseRestClient(settings).select(
        "profiles",
        token,
        columns="display_name,role",
        filters={"id": payload["id"]},
        limit=1,
    )
    profile = profile_rows[0] if profile_rows else {}
    try:
        user_role = UserRole(profile.get("role", UserRole.OPERATOR.value))
    except ValueError:
        user_role = UserRole.OPERATOR
    user = CurrentUser(
        id=payload["id"],
        email=payload.get("email"),
        display_name=profile.get("display_name"),
        role=user_role,
    )
    _auth_cache[token_digest] = (time.monotonic(), user)
    if len(_auth_cache) > 256:
        oldest = min(_auth_cache, key=lambda key: _auth_cache[key][0])
        _auth_cache.pop(oldest, None)
    return AuthContext(user=user, access_token=token)


def get_database(settings: Annotated[Settings, Depends(get_settings)]) -> SupabaseRestClient:
    return SupabaseRestClient(settings)


def get_auth_admin(
    settings: Annotated[Settings, Depends(get_settings)],
) -> SupabaseAuthAdminClient:
    return SupabaseAuthAdminClient(settings)


def require_admin(
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> AuthContext:
    if auth.user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Apenas administradores podem gerenciar usuários.",
        )
    return auth


def get_robot_gateway(
    settings: Annotated[Settings, Depends(get_settings)],
) -> RobotGatewayClient:
    return RobotGatewayClient(settings)


def require_integration_key(
    settings: Annotated[Settings, Depends(get_settings)],
    x_integration_key: Annotated[str | None, Header()] = None,
) -> str:
    expected = settings.integration_api_key
    if (
        not expected
        or not x_integration_key
        or not hmac.compare_digest(expected, x_integration_key)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Chave de integração inválida.",
        )
    if not settings.supabase_service_role_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Chave de serviço do Supabase não configurada.",
        )
    return settings.supabase_service_role_key
