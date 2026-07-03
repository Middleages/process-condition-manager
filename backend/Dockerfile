FROM python:3.13-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/usr/local

WORKDIR /app

# uv 바이너리 (폐쇄망에서는 사내 미러/번들 이미지로 대체)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# 의존성 레이어 (lockfile 기반 재현성)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
