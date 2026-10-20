from fastapi import APIRouter

from app.api.v1 import auth, github, health, imports, ops, projects, views, work

router = APIRouter()
router.include_router(health.router)
router.include_router(auth.router)
router.include_router(projects.router)
router.include_router(imports.router)
router.include_router(work.router)
router.include_router(views.router)
router.include_router(github.router)
router.include_router(github.internal)
router.include_router(ops.router)
