"""Cliente assíncrono do gateway ROS que roda localmente na Jetson."""

import math
from typing import Any

import httpx

from app.config import Settings


class RobotGatewayError(RuntimeError):
    """Erro base ao conversar com o gateway do robô."""


class RobotGatewayUnavailable(RobotGatewayError):
    """Gateway desligado, inacessível ou fora do tempo limite."""


class RobotGatewayRejected(RobotGatewayError):
    """O gateway recebeu a requisição, mas recusou a operação."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


class RobotGatewayClient:
    def __init__(self, settings: Settings):
        self.base_url = settings.robot_gateway_url.rstrip("/")
        self.api_key = settings.robot_gateway_api_key
        self.timeout = settings.robot_gateway_timeout_seconds

    @property
    def configured(self) -> bool:
        return bool(self.base_url)

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            return {}
        return {"X-Gateway-Key": self.api_key}

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
    ) -> httpx.Response:
        if not self.configured:
            raise RobotGatewayUnavailable("Gateway local do Go2 não configurado.")
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.request(
                    method,
                    f"{self.base_url}{path}",
                    json=json,
                    headers=self._headers(),
                )
        except httpx.RequestError as exc:
            raise RobotGatewayUnavailable(
                "Gateway local do Go2 está indisponível."
            ) from exc

        if response.status_code >= 400:
            payload = None
            try:
                payload = response.json()
            except ValueError:
                pass
            message = (
                (payload or {}).get("error")
                or (payload or {}).get("detail")
                or "O gateway recusou a operação."
            )
            raise RobotGatewayRejected(message, response.status_code)
        return response

    async def status(self) -> dict[str, Any]:
        return (await self._request("GET", "/api/status")).json()

    async def map_points(self) -> dict[str, Any]:
        return (await self._request("GET", "/api/map/points")).json()

    async def camera_frame(self) -> tuple[bytes, str]:
        response = await self._request("GET", "/api/camera/frame")
        return response.content, response.headers.get("content-type", "image/jpeg")

    async def audio_megaphone(
        self,
        action: str,
        *,
        data: str = "",
        current_block_index: int = 1,
        total_block_number: int = 1,
        delay_seconds: float = 0.45,
    ) -> dict[str, Any]:
        return (
            await self._request(
                "POST",
                "/api/audio/megaphone",
                json={
                    "action": action,
                    "data": data,
                    "current_block_index": current_block_index,
                    "total_block_number": total_block_number,
                    "delay_seconds": delay_seconds,
                },
            )
        ).json()

    async def execute(
        self,
        command: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = payload or {}
        if command == "move_analog":
            axes = {}
            for name in ("forward", "lateral", "yaw"):
                value = payload.get(name)
                if isinstance(value, bool):
                    raise RobotGatewayRejected(
                        "Eixos do controle devem ficar entre -1 e 1."
                    )
                try:
                    value = float(value)
                except (TypeError, ValueError) as error:
                    raise RobotGatewayRejected(
                        "Eixos do controle devem ficar entre -1 e 1."
                    ) from error
                if not math.isfinite(value) or not -1.0 <= value <= 1.0:
                    raise RobotGatewayRejected(
                        "Eixos do controle devem ficar entre -1 e 1."
                    )
                axes[name] = value
            return (
                await self._request(
                    "POST",
                    "/api/control/joystick",
                    json=axes,
                )
            ).json()
        if command in {
            "forward",
            "backward",
            "rotate_left",
            "rotate_right",
            "stop",
        }:
            return (
                await self._request(
                    "POST",
                    "/api/control/move",
                    json={"command": command},
                )
            ).json()
        if command in {"stand_up", "stand_down", "recovery_stand"}:
            return (
                await self._request(
                    "POST",
                    "/api/control/posture",
                    json={"command": command},
                )
            ).json()
        if command in {"arm", "disarm"}:
            return (
                await self._request(
                    "POST",
                    "/api/control/arm",
                    json={"armed": command == "arm"},
                )
            ).json()
        if command == "set_speed":
            return (
                await self._request(
                    "POST",
                    "/api/control/speed",
                    json={"percent": payload.get("percent")},
                )
            ).json()
        if command == "set_obstacle_avoidance":
            enabled = payload.get("enabled")
            if not isinstance(enabled, bool):
                raise RobotGatewayRejected(
                    "Estado do anticolisão deve ser booleano."
                )
            return (
                await self._request(
                    "POST",
                    "/api/control/obstacle-avoidance",
                    json={"enabled": enabled},
                )
            ).json()
        if command == "damping":
            return (
                await self._request("POST", "/api/control/damping", json={})
            ).json()
        if command == "reset_map":
            return (await self._request("POST", "/api/map/reset", json={})).json()
        if command == "save_map":
            return (await self._request("POST", "/api/map/save", json={})).json()
        if command == "calibrate_docking_station":
            return (
                await self._request("POST", "/api/docking/calibrate", json={})
            ).json()
        if command == "start_docking":
            return (
                await self._request("POST", "/api/docking/start", json={})
            ).json()
        if command == "cancel_docking":
            return (
                await self._request("POST", "/api/docking/cancel", json={})
            ).json()
        if command == "emergency_stop":
            return (
                await self._request("POST", "/api/control/stop", json={})
            ).json()
        raise RobotGatewayRejected("Comando do robô não reconhecido.")
