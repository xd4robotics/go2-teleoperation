from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import auth, health, integrations, oracle, robot


settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="API de autenticação, auditoria e integração do painel XD4 Robotics.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Integration-Key"],
)

app.include_router(health.router)
app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(robot.router, prefix=settings.api_prefix)
app.include_router(oracle.router, prefix=settings.api_prefix)
app.include_router(integrations.router, prefix=settings.api_prefix)
