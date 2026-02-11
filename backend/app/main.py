from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings

app = FastAPI(title=settings.APP_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:80"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "app": settings.APP_NAME}


# 라우터 등록은 Sprint 2에서 추가
# from app.routers import products, projects, conditions, columns, validation
# app.include_router(products.router, prefix="/api/products", tags=["products"])
# app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
# app.include_router(conditions.router, prefix="/api", tags=["conditions"])
# app.include_router(columns.router, prefix="/api/columns", tags=["columns"])
# app.include_router(validation.router, prefix="/api", tags=["validation"])
