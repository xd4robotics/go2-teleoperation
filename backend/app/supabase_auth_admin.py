from typing import Any

import httpx
from fastapi import HTTPException, status

from app.config import Settings


class SupabaseAuthAdminClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    def _headers(self) -> dict[str, str]:
        service_key = self.settings.supabase_service_role_key
        if not self.settings.supabase_url or not service_key:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Administração de usuários não configurada no backend.",
            )

        headers = {
            "apikey": service_key,
            "Content-Type": "application/json",
        }
        # As chaves sb_secret_* não são JWTs e devem ir somente em apikey.
        if not service_key.startswith("sb_secret_"):
            headers["Authorization"] = f"Bearer {service_key}"
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        url = f"{self.settings.supabase_url.rstrip('/')}/auth/v1/{path.lstrip('/')}"
        async with httpx.AsyncClient(timeout=12.0) as client:
            try:
                response = await client.request(
                    method,
                    url,
                    headers=self._headers(),
                    json=json,
                )
            except httpx.RequestError as exc:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="O serviço de autenticação está temporariamente indisponível.",
                ) from exc

        if response.status_code >= 400:
            try:
                payload = response.json() if response.content else {}
            except ValueError:
                payload = {}
            error_code = payload.get("error_code") or payload.get("code")
            message = str(payload.get("msg") or payload.get("message") or "").lower()
            if response.status_code in {400, 409, 422} and (
                error_code in {"email_exists", "user_already_exists"}
                or "already been registered" in message
                or "already exists" in message
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Já existe um usuário com este e-mail.",
                )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="O Supabase recusou a criação do usuário.",
            )

        if not response.content:
            return None
        return response.json()

    async def create_user(
        self,
        *,
        email: str,
        password: str,
        display_name: str | None,
    ) -> dict[str, Any]:
        response_payload = await self._request(
            "POST",
            "admin/users",
            json={
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {"display_name": display_name} if display_name else {},
            },
        )
        payload = (response_payload or {}).get("user", response_payload)
        if not payload or not payload.get("id"):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="O Supabase não retornou o usuário criado.",
            )
        return payload

    async def delete_user(self, user_id: str) -> None:
        await self._request(
            "DELETE",
            f"admin/users/{user_id}",
            json={"should_soft_delete": False},
        )
