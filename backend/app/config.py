from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://pcm_user:pcm_pass@db:5432/pcm"
    DATABASE_URL_SYNC: str = "postgresql://pcm_user:pcm_pass@db:5432/pcm"
    SECRET_KEY: str = "change-this-secret-key"
    APP_NAME: str = "Process Condition Manager"
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:80,http://localhost"

    class Config:
        env_file = ".env"


settings = Settings()
