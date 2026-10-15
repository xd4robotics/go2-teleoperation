from typing import Any

import httpx
from fastapi import HTTPException, status

from app.config import Settings


class SupabaseRestClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    def _ensure_configured(self) -> None:
        if not self.settings.supabase_configured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Supabase ainda não foi configurado no backend.",
            )

    def _headers(
        self,
        access_token: str,
        prefer: str | None = None,
    ) -> dict[str, str]:
        self._ensure_configured()
        is_service_request = access_token == self.settings.supabase_service_role_key
        api_key = (
            access_token
            if is_service_request
            else self.settings.supabase_publishable_key
        )
        headers = {
            "apikey": api_key,
            "Content-Type": "application/json",
        }
        # As novas chaves sb_secret_* não são JWTs e não podem ser usadas como Bearer.
        # A chave service_role legada continua precisando do Authorization.
        if not (is_service_request and access_token.startswith("sb_secret_")):
            headers["Authorization"] = f"Bearer {access_token}"
        if prefer:
            headers["Prefer"] = prefer
        return headers

    async def request(
        self,
        method: str,
        path: str,
        access_token: str,
        *,
        params: dict[str, str] | None = None,
        json: Any = None,
        prefer: str | None = None,
    ) -> Any:
        url = f"{self.settings.supabase_url.rstrip('/')}/rest/v1/{path.lstrip('/')}"
        async with httpx.AsyncClient(timeout=12.0) as client:
            try:
                response = await client.request(
                    method,
                    url,
                    params=params,
                    json=json,
                    headers=self._headers(access_token, prefer),
                )
            except httpx.RequestError as exc:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Banco de dados temporariamente indisponível.",
                ) from exc

        if response.status_code >= 400:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="O Supabase recusou a operação solicitada.",
            )

        if not response.content:
            return None
        return response.json()

    async def select(
        self,
        table: str,
        access_token: str,
        *,
        columns: str = "*",
        filters: dict[str, str] | None = None,
        order: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        params = {"select": columns}
        for key, value in (filters or {}).items():
            params[key] = f"eq.{value}"
        if order:
            params["order"] = order
        if limit is not None:
            params["limit"] = str(limit)
        return await self.request("GET", table, access_token, params=params)

    async def insert(
        self,
        table: str,
        access_token: str,
        payload: dict[str, Any],
        *,
        return_representation: bool = True,
    ) -> list[dict[str, Any]] | None:
        prefer = "return=representation" if return_representation else "return=minimal"
        return await self.request(
            "POST",
            table,
            access_token,
            json=payload,
            prefer=prefer,
        )

    async def update(
        self,
        table: str,
        access_token: str,
        payload: dict[str, Any],
        filters: dict[str, str],
    ) -> list[dict[str, Any]] | None:
        params = {key: f"eq.{value}" for key, value in filters.items()}
        return await self.request(
            "PATCH",
            table,
            access_token,
            params=params,
            json=payload,
            prefer="return=representation",
        )

    async def upsert(
        self,
        table: str,
        access_token: str,
        payload: dict[str, Any],
        *,
        on_conflict: str,
    ) -> list[dict[str, Any]] | None:
        return await self.request(
            "POST",
            table,
            access_token,
            params={"on_conflict": on_conflict},
            json=payload,
            prefer="resolution=merge-duplicates,return=representation",
        )
