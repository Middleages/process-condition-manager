"""SQLAlchemy 모델 (앱 DB 전용).

구체 모델은 T3(파라미터 레지스트리) 이후 추가된다.
Alembic autogenerate가 참조할 Base metadata를 노출한다.
"""

from app.core.db import Base

__all__ = ["Base"]
