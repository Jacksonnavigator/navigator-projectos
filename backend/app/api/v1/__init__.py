from fastapi import APIRouter

from app.api.v1 import auth, health, imports, projects, views, work

router = APIRouter()
router.include_router(health.router)
router.include_router(auth.router)
router.include_router(projects.router)
router.include_router(imports.router)
router.include_router(work.router)
router.include_router(views.router)
