"""이미지 업로드 라우터: 공지사항/변경요청 본문에 삽입할 이미지를 처리한다."""

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from app.dependencies.auth import require_active_user

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

UPLOAD_DIR = Path("/app/uploads")
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB


class UploadResponse(BaseModel):
    url: str


@router.post("", response_model=UploadResponse)
async def upload_image(
    file: UploadFile = File(...),
    _user=Depends(require_active_user),
) -> UploadResponse:
    """이미지 파일을 업로드하고 접근 가능한 URL을 반환한다."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="파일 이름이 없습니다.")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"허용되지 않는 파일 형식입니다. 허용: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="파일 크기가 5MB를 초과합니다.")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = UPLOAD_DIR / filename
    filepath.write_bytes(content)

    return UploadResponse(url=f"/api/uploads/{filename}")


@router.get("/{filename}")
async def get_upload(filename: str):
    """업로드된 파일을 서빙한다."""
    filepath = UPLOAD_DIR / filename
    if not filepath.exists() or not filepath.is_file():
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")

    # 경로 순회 방지
    if filepath.resolve().parent != UPLOAD_DIR.resolve():
        raise HTTPException(status_code=400, detail="잘못된 파일 경로입니다.")

    from fastapi.responses import FileResponse
    return FileResponse(filepath)
