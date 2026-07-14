"""Manual project metadata provider used until a source adapter is approved."""

from app.project_metadata.provider import ProjectMetadataProvider, ProjectProfileSeed


class ManualProjectMetadataProvider:
    """Return an auditable empty seed without contacting an external source."""

    identifier = "manual"

    async def load_seed(
        self, *, line_id: str, process_id: str, part_id: str
    ) -> ProjectProfileSeed:
        return ProjectProfileSeed()


_manual_provider = ManualProjectMetadataProvider()


def get_project_metadata_provider() -> ProjectMetadataProvider:
    """Provide the shared stateless manual provider for FastAPI injection."""
    return _manual_provider
