"""Conservative v1 input and job limits."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ArtifactLimits:
    max_input_bytes: int = 64 * 1024 * 1024
    max_output_bytes: int = 128 * 1024 * 1024
    max_archive_entries: int = 10_000
    max_archive_entry_bytes: int = 64 * 1024 * 1024
    max_archive_uncompressed_bytes: int = 256 * 1024 * 1024
    max_compression_ratio: float = 100.0
    max_slides: int = 200
    max_pdf_pages: int = 200
    max_image_dimension: int = 20_000
    max_image_pixels: int = 100_000_000
    max_preview_dimension: int = 4_096
    max_timeout_seconds: int = 600


DEFAULT_LIMITS = ArtifactLimits()
