"""Entry point for python -m app.seed execution."""
import sys

from app.seed.runner import seed

if __name__ == "__main__":
    try:
        seed()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
