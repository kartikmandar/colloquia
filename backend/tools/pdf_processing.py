"""PDF processing utilities for paper context injection.

Handles fulltext quality assessment, page selection for rendering,
JPEG rendering via PyMuPDF, and coordinate mapping between Gemini's
normalized space and PDF points.
"""

import base64
import io
import logging
import math
from typing import Any

import fitz  # PyMuPDF

logger: logging.Logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Fulltext quality heuristic
# ---------------------------------------------------------------------------

def should_reextract(fulltext: str, page_count: int) -> bool:
    """Decide whether Zotero's cached fulltext is good enough.

    Returns True if the fulltext is suspiciously short relative to
    page count, suggesting the PDF wasn't OCR'd or extraction failed.
    """
    if not fulltext or not fulltext.strip():
        return True

    words: int = len(fulltext.split())
    # A typical academic page has ~300-500 words.
    # If we get less than 50 words/page, extraction likely failed.
    expected_minimum: int = page_count * 50
    if words < expected_minimum:
        logger.info(
            "Fulltext seems sparse: %d words for %d pages (expected >= %d)",
            words, page_count, expected_minimum,
        )
        return True

    # Check for garbled text (high ratio of non-ASCII characters)
    non_ascii: int = sum(1 for c in fulltext if ord(c) > 127 and not c.isalpha())
    if len(fulltext) > 0 and non_ascii / len(fulltext) > 0.3:
        logger.info("Fulltext appears garbled (%.1f%% non-ascii)", non_ascii / len(fulltext) * 100)
        return True

    return False


# ---------------------------------------------------------------------------
# Page selection for rendering
# ---------------------------------------------------------------------------

# Maximum pages to render per tier
_TIER1_MAX: int = 20  # Short papers: render all
_TIER2_MAX: int = 15  # Medium papers: first, last, figures
_TIER3_MAX: int = 10  # Long papers: strategic selection


def select_pages_for_rendering(pdf_path: str) -> list[int]:
    """Select which pages to render as images for Gemini vision context.

    Strategy:
    - Tier 1 (≤20 pages): Render all pages
    - Tier 2 (21-40 pages): First 3, last 2, and pages with figures/tables
    - Tier 3 (>40 pages): First 2, last 1, and figure-heavy pages

    Returns 0-indexed page indices.
    """
    doc: fitz.Document = fitz.open(pdf_path)
    total: int = len(doc)

    if total == 0:
        doc.close()
        return []

    # Tier 1: short papers — render everything
    if total <= _TIER1_MAX:
        doc.close()
        return list(range(total))

    # For longer papers, find pages with images (likely figures)
    figure_pages: list[int] = _find_figure_pages(doc)

    if total <= 40:
        # Tier 2: medium papers
        must_include: set[int] = set(range(min(3, total)))  # first 3
        must_include.update(range(max(0, total - 2), total))  # last 2
        must_include.update(figure_pages)

        selected: list[int] = sorted(must_include)
        if len(selected) > _TIER2_MAX:
            selected = _prioritize_pages(selected, figure_pages, _TIER2_MAX, total)
    else:
        # Tier 3: long papers
        must_include = set(range(min(2, total)))  # first 2
        must_include.add(total - 1)  # last page
        must_include.update(figure_pages)

        selected = sorted(must_include)
        if len(selected) > _TIER3_MAX:
            selected = _prioritize_pages(selected, figure_pages, _TIER3_MAX, total)

    doc.close()
    return selected


def _find_figure_pages(doc: fitz.Document) -> list[int]:
    """Identify pages that likely contain figures or tables.

    Heuristics:
    - Pages with images larger than 100x100 pixels
    - Pages containing "Figure" or "Table" text near images
    """
    figure_pages: list[int] = []

    for page_idx in range(len(doc)):
        page: fitz.Page = doc[page_idx]

        # Check for embedded images
        image_list: list[tuple[Any, ...]] = page.get_images(full=True)
        has_significant_image: bool = False
        for img in image_list:
            xref: int = img[0]
            try:
                img_info: dict[str, Any] = doc.extract_image(xref)
                width: int = img_info.get("width", 0)
                height: int = img_info.get("height", 0)
                if width > 100 and height > 100:
                    has_significant_image = True
                    break
            except Exception:
                continue

        if has_significant_image:
            figure_pages.append(page_idx)
            continue

        # Check for figure/table captions in text
        text: str = page.get_text("text")
        text_lower: str = text.lower()
        if "figure " in text_lower or "fig. " in text_lower or "table " in text_lower:
            # Only count if the caption text is present (not just mentions)
            for keyword in ["figure ", "fig. ", "table "]:
                if keyword in text_lower:
                    figure_pages.append(page_idx)
                    break

    return figure_pages


def _prioritize_pages(
    selected: list[int],
    figure_pages: list[int],
    max_pages: int,
    total: int,
) -> list[int]:
    """Trim selected pages to max_pages, keeping the most important ones.

    Priority: first page > last page > figure pages > evenly spaced
    """
    priority: list[int] = []

    # Always keep first and last
    if 0 in selected:
        priority.append(0)
    if total - 1 in selected and total - 1 != 0:
        priority.append(total - 1)

    # Add figure pages
    figure_set: set[int] = set(figure_pages)
    for p in selected:
        if p in figure_set and p not in priority:
            priority.append(p)
            if len(priority) >= max_pages:
                return sorted(priority)

    # Fill remaining slots with evenly spaced pages
    remaining: list[int] = [p for p in selected if p not in priority]
    slots: int = max_pages - len(priority)
    if slots > 0 and remaining:
        step: int = max(1, len(remaining) // slots)
        for i in range(0, len(remaining), step):
            priority.append(remaining[i])
            if len(priority) >= max_pages:
                break

    return sorted(priority[:max_pages])


# ---------------------------------------------------------------------------
# Page rendering
# ---------------------------------------------------------------------------

def render_pages(
    pdf_path: str,
    page_indices: list[int],
    dpi: int = 150,
) -> list[dict[str, Any]]:
    """Render selected PDF pages as JPEG images.

    Returns a list of dicts with:
    - pageIndex: 0-based page index
    - imageBase64: base64-encoded JPEG
    - width: page width in PDF points
    - height: page height in PDF points
    - widthPx: rendered image width in pixels
    - heightPx: rendered image height in pixels
    """
    doc: fitz.Document = fitz.open(pdf_path)
    results: list[dict[str, Any]] = []

    zoom: float = dpi / 72.0  # PDF default is 72 DPI
    matrix: fitz.Matrix = fitz.Matrix(zoom, zoom)

    for idx in page_indices:
        if idx < 0 or idx >= len(doc):
            logger.warning("Page index %d out of range (total: %d), skipping", idx, len(doc))
            continue

        page: fitz.Page = doc[idx]
        rect: fitz.Rect = page.rect

        # Render to pixmap
        pixmap: fitz.Pixmap = page.get_pixmap(matrix=matrix)

        # Convert to JPEG bytes
        jpeg_bytes: bytes = pixmap.tobytes(output="jpeg", jpg_quality=85)
        encoded: str = base64.b64encode(jpeg_bytes).decode("ascii")

        results.append({
            "pageIndex": idx,
            "imageBase64": encoded,
            "width": rect.width,    # PDF points
            "height": rect.height,  # PDF points
            "widthPx": pixmap.width,
            "heightPx": pixmap.height,
        })

    doc.close()
    return results


def get_page_dimensions(pdf_path: str) -> list[dict[str, float]]:
    """Get dimensions (in PDF points) for all pages in a PDF.

    Returns list of {width, height} dicts, indexed by page number.
    """
    doc: fitz.Document = fitz.open(pdf_path)
    dims: list[dict[str, float]] = []

    for page in doc:
        rect: fitz.Rect = page.rect
        dims.append({"width": rect.width, "height": rect.height})

    doc.close()
    return dims


# ---------------------------------------------------------------------------
# Coordinate mapping: Gemini normalized → PDF points
# ---------------------------------------------------------------------------

def gemini_to_pdf_coords(
    gemini_box: list[int],
    page_width: float,
    page_height: float,
) -> list[list[float]]:
    """Convert Gemini's normalized bounding box to PDF annotation coordinates.

    Gemini returns bounding boxes as [y_min, x_min, y_max, x_max] in
    0-1000 normalized space, with origin at top-left.

    PDF annotations use [x1, y1, x2, y2] in PDF points, with origin
    at bottom-left.

    Args:
        gemini_box: [y_min, x_min, y_max, x_max] in 0-1000 space
        page_width: Page width in PDF points
        page_height: Page height in PDF points

    Returns:
        [[x1, y1, x2, y2]] in PDF points (bottom-left origin)
    """
    if len(gemini_box) != 4:
        raise ValueError(f"Expected 4-element bounding box, got {len(gemini_box)}")

    y_min_norm: int = gemini_box[0]
    x_min_norm: int = gemini_box[1]
    y_max_norm: int = gemini_box[2]
    x_max_norm: int = gemini_box[3]

    # Validate ranges
    for val in gemini_box:
        if val < 0 or val > 1000:
            raise ValueError(f"Bounding box value {val} outside 0-1000 range")

    # Check for degenerate boxes (all zeros or zero area)
    if all(v == 0 for v in gemini_box):
        raise ValueError("All-zero bounding box — Gemini failed to localize")

    if y_min_norm >= y_max_norm or x_min_norm >= x_max_norm:
        raise ValueError(
            f"Degenerate bounding box: y_min={y_min_norm} >= y_max={y_max_norm} "
            f"or x_min={x_min_norm} >= x_max={x_max_norm}"
        )

    # Convert from 0-1000 normalized to PDF points
    x1: float = (x_min_norm / 1000.0) * page_width
    x2: float = (x_max_norm / 1000.0) * page_width

    # Y-axis flip: Gemini origin is top-left, PDF origin is bottom-left
    y1: float = page_height - (y_max_norm / 1000.0) * page_height
    y2: float = page_height - (y_min_norm / 1000.0) * page_height

    # Clamp to page bounds
    x1 = max(0.0, min(x1, page_width))
    x2 = max(0.0, min(x2, page_width))
    y1 = max(0.0, min(y1, page_height))
    y2 = max(0.0, min(y2, page_height))

    return [[x1, y1, x2, y2]]


def validate_annotation_coords(
    rects: list[list[float]],
    page_width: float,
    page_height: float,
) -> tuple[bool, str]:
    """Validate that annotation coordinates are reasonable.

    Rejects:
    - All-zero coordinates
    - Coordinates outside page bounds
    - Extremely small annotations (< 5 points in either dimension)

    Returns:
        Tuple of (is_valid, error_message). error_message is empty if valid.
    """
    for rect in rects:
        if len(rect) != 4:
            return False, f"Expected 4 coordinates, got {len(rect)}"

        x1, y1, x2, y2 = rect

        # All zeros
        if all(v == 0.0 for v in rect):
            return False, "All coordinates are zero"

        # Outside page bounds (with small tolerance)
        tolerance: float = 1.0
        if (x1 < -tolerance or y1 < -tolerance or
                x2 > page_width + tolerance or y2 > page_height + tolerance):
            return False, f"Coordinates outside page bounds ({page_width}x{page_height})"

        # Too small (< 5 PDF points ≈ 1.8mm)
        if abs(x2 - x1) < 5.0 or abs(y2 - y1) < 5.0:
            return False, "Annotation too small (< 5 PDF points)"

    return True, ""
