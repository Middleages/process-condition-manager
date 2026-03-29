"""사내 SSO id_token 검증 서비스."""

from pathlib import Path

from cryptography import x509
from cryptography.hazmat.backends import default_backend
from jose import JWTError, jwt

from app.config import settings


class SSOValidationError(Exception):
    """SSO 토큰 검증 실패."""


def _load_public_key():
    cert_path = Path(settings.CERTFILE_PATH) / settings.CERTFILE_NAME
    with cert_path.open("rb") as cert_file:
        cert_data = cert_file.read()
    cert = x509.load_pem_x509_certificate(cert_data, default_backend())
    return cert.public_key()


def verify_sso_id_token(id_token: str) -> dict:
    """가이드 정책(verify_aud=False, verify_nbf=False)에 맞춰 id_token 검증."""
    public_key = _load_public_key()
    try:
        return jwt.decode(
            token=id_token,
            key=public_key,
            algorithms=["RS256"],
            options={
                "verify_signature": True,
                "verify_exp": True,
                "verify_aud": False,
                "verify_nbf": False,
            },
        )
    except JWTError as exc:
        raise SSOValidationError("Token verification failed") from exc
