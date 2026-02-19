"""Seed package for PCM development data.

Usage:
    docker-compose exec backend python -m app.seed

Idempotent: checks if data already exists before inserting.
"""
from app.seed.runner import seed

__all__ = ["seed"]
