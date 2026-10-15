from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.config import Settings
from app.dependencies import require_admin
from app.models import AdminUserCreateIn, AuthContext, CurrentUser, UserRole
from app.routers.auth import create_user
from app.supabase_auth_admin import SupabaseAuthAdminClient


USER_ID = UUID("00000000-0000-0000-0000-000000000123")


def auth_context(role: UserRole) -> AuthContext:
    return AuthContext(
        user=CurrentUser(id=USER_ID, email="user@example.com", role=role),
        access_token="user-jwt",
    )


def test_operator_cannot_manage_users() -> None:
    with pytest.raises(HTTPException) as raised:
        require_admin(auth_context(UserRole.OPERATOR))

    assert raised.value.status_code == 403


def test_admin_can_manage_users() -> None:
    auth = auth_context(UserRole.ADMIN)

    assert require_admin(auth) is auth


def test_secret_key_is_not_used_as_auth_admin_bearer() -> None:
    client = SupabaseAuthAdminClient(
        Settings(
            supabase_url="https://example.supabase.co",
            supabase_service_role_key="sb_secret_backend",
        )
    )

    assert client._headers() == {
        "apikey": "sb_secret_backend",
        "Content-Type": "application/json",
    }


@pytest.mark.asyncio
async def test_admin_creates_operator_with_confirmed_access() -> None:
    class FakeAuthAdmin:
        deleted = []

        async def create_user(self, **payload):
            assert payload == {
                "email": "operator@example.com",
                "password": "safe-pass-123",
                "display_name": "Operador Go2",
            }
            return {"id": str(USER_ID), "email": payload["email"]}

        async def delete_user(self, user_id):
            self.deleted.append(user_id)

    class FakeDatabase:
        settings = SimpleNamespace(supabase_service_role_key="service-role")

        async def update(self, table, access_token, payload, filters):
            assert table == "profiles"
            assert access_token == "service-role"
            assert payload["role"] == "operator"
            assert filters == {"id": str(USER_ID)}
            return [payload]

    result = await create_user(
        AdminUserCreateIn(
            email="operator@example.com",
            password="safe-pass-123",
            display_name="Operador Go2",
            role=UserRole.OPERATOR,
        ),
        auth_context(UserRole.ADMIN),
        FakeDatabase(),
        FakeAuthAdmin(),
    )

    assert result.id == USER_ID
    assert result.role == UserRole.OPERATOR
    assert result.display_name == "Operador Go2"


@pytest.mark.asyncio
async def test_auth_user_is_removed_when_profile_creation_fails() -> None:
    class FakeAuthAdmin:
        deleted = []

        async def create_user(self, **_payload):
            return {"id": str(USER_ID), "email": "admin@example.com"}

        async def delete_user(self, user_id):
            self.deleted.append(user_id)

    class FakeDatabase:
        settings = SimpleNamespace(supabase_service_role_key="service-role")

        async def update(self, *_args, **_kwargs):
            return []

    auth_admin = FakeAuthAdmin()
    with pytest.raises(HTTPException) as raised:
        await create_user(
            AdminUserCreateIn(
                email="admin@example.com",
                password="safe-pass-123",
                role=UserRole.ADMIN,
            ),
            auth_context(UserRole.ADMIN),
            FakeDatabase(),
            auth_admin,
        )

    assert raised.value.status_code == 502
    assert auth_admin.deleted == [str(USER_ID)]
