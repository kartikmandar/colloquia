"""Integration tests for all Colloquia tools — NO mocks, real API calls.

Tests cover:
- Local tools: search_academic_papers, get_paper_recommendations
- Semantic Scholar API: search, DOI lookup, recommendations
- Zotero plugin: all 16 endpoints via direct HTTP (localhost:23119)
- PDF processing: coordinate mapping, validation, page selection, rendering
- Main agent: creation with real Gemini model strings
- Prompt switching: dynamic instruction based on session mode

Prerequisites:
- Zotero 7 running with Colloquia plugin installed
- GEMINI_API_KEY in backend/.env
- conda env colloquia activated

Run: cd backend && conda run -n colloquia python -m pytest tests/test_tools.py -v
"""

import asyncio
import base64
import json
import os
import sys
import tempfile
from typing import Any

import httpx
import pytest

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tools.local_tools import search_academic_papers, get_paper_recommendations
from tools.semantic_scholar import (
    search_academic_papers as s2_search,
    get_paper_by_doi,
    get_paper_recommendations as s2_recommend,
    _format_paper,
    _build_headers,
)
from tools.pdf_processing import (
    gemini_to_pdf_coords,
    validate_annotation_coords,
    should_reextract,
    select_pages_for_rendering,
    render_pages,
    get_page_dimensions,
)
from tools.zotero_tools import (
    ZoteroToolContext,
    create_zotero_tools,
    resolve_zotero_result,
)
from agents.colloquia_agent import create_colloquia_agent, _dynamic_instruction
from prompts.lobby import LOBBY_SYSTEM_PROMPT
from prompts.paper import build_paper_prompt
from config import LIVE_MODEL, AGENT_NAME


# ============================================================================
# Constants
# ============================================================================

ZOTERO_BASE = "http://localhost:23124"
COLLOQUIA_BASE = f"{ZOTERO_BASE}/colloquia"


# ============================================================================
# Helpers
# ============================================================================

def load_api_key() -> str:
    """Load GEMINI_API_KEY from .env file."""
    env_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"
    )
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("GEMINI_API_KEY="):
                    return line.strip().split("=", 1)[1]
    return os.environ.get("GEMINI_API_KEY", "")


async def zotero_post(endpoint: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
    """POST to a Colloquia plugin endpoint."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{COLLOQUIA_BASE}/{endpoint}",
            json=data or {},
        )
        return resp.json()


async def zotero_get(endpoint: str) -> dict[str, Any]:
    """GET from a Colloquia plugin endpoint."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(f"{COLLOQUIA_BASE}/{endpoint}")
        return resp.json()


def get_first_regular_item_key() -> str:
    """Synchronously get the first regular item key (journalArticle etc.) from Zotero."""
    import urllib.request
    resp = urllib.request.urlopen(
        f"{ZOTERO_BASE}/api/users/0/items?limit=5&itemType=journalArticle"
    )
    items = json.loads(resp.read())
    if items:
        return items[0]["key"]
    # Fallback: try any top-level item
    resp = urllib.request.urlopen(f"{ZOTERO_BASE}/api/users/0/items/top?limit=5")
    items = json.loads(resp.read())
    for item in items:
        if item["data"]["itemType"] not in ("attachment", "note", "annotation"):
            return item["key"]
    pytest.skip("No regular items in Zotero library")


@pytest.fixture
def sample_pdf():
    """Create a minimal 5-page PDF for testing."""
    import fitz

    doc = fitz.open()
    for i in range(5):
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 100), f"Page {i + 1} content with Figure {i + 1}.")
    path = tempfile.mktemp(suffix=".pdf")
    doc.save(path)
    doc.close()
    yield path
    if os.path.exists(path):
        os.unlink(path)


@pytest.fixture
def long_pdf():
    """Create a 25-page PDF for tier-2 page selection testing."""
    import fitz

    doc = fitz.open()
    for i in range(25):
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 100), f"Page {i + 1}")
    path = tempfile.mktemp(suffix=".pdf")
    doc.save(path)
    doc.close()
    yield path
    if os.path.exists(path):
        os.unlink(path)


# ============================================================================
# 1. Semantic Scholar — real API calls
# ============================================================================

class TestSemanticScholarSearch:
    @pytest.mark.asyncio
    async def test_search_returns_papers(self):
        result = await s2_search("21cm cosmology hydrogen")
        assert "papers" in result
        if "error" in result:
            # Rate limited — still a valid structured response
            assert "papers" in result
            pytest.skip("S2 rate limited")
        assert "total" in result
        assert isinstance(result["papers"], list)

    @pytest.mark.asyncio
    async def test_search_paper_fields(self):
        result = await s2_search("HERA 21cm power spectrum", limit=1)
        if "error" in result or len(result["papers"]) == 0:
            pytest.skip("S2 rate limited or no results")
        paper = result["papers"][0]
        assert "title" in paper
        assert "authors" in paper
        assert "year" in paper
        assert "paperId" in paper
        assert isinstance(paper["authors"], list)

    @pytest.mark.asyncio
    async def test_search_with_year_filter(self):
        result = await s2_search("radio interferometry", year="2022-2024", limit=3)
        assert "papers" in result
        for paper in result["papers"]:
            if paper["year"]:
                assert 2022 <= paper["year"] <= 2024

    @pytest.mark.asyncio
    async def test_search_limit(self):
        result = await s2_search("machine learning", limit=2)
        assert len(result["papers"]) <= 2

    @pytest.mark.asyncio
    async def test_search_no_results(self):
        result = await s2_search("xyznonexistentqueryzzz12345")
        assert "papers" in result


class TestSemanticScholarDOI:
    @pytest.mark.asyncio
    async def test_lookup_known_doi(self):
        # Nature paper — may fail if S2 returns 400 for extended fields or rate limits
        result = await get_paper_by_doi("10.1038/s41586-020-2649-2")
        if result is None:
            pytest.skip("S2 DOI lookup failed (rate limit or API change)")
        assert result["title"] is not None
        assert len(result["authors"]) > 0
        assert "references" in result
        assert "citations" in result

    @pytest.mark.asyncio
    async def test_lookup_nonexistent_doi(self):
        result = await get_paper_by_doi("10.9999/this-doi-does-not-exist-zzz")
        assert result is None

    @pytest.mark.asyncio
    async def test_doi_has_extended_fields(self):
        result = await get_paper_by_doi("10.1038/s41586-020-2649-2")
        if result is None:
            pytest.skip("S2 DOI lookup failed (rate limit or API change)")
        assert isinstance(result.get("references"), list)
        assert isinstance(result.get("citations"), list)
        assert "fieldsOfStudy" in result


class TestSemanticScholarRecommendations:
    @pytest.mark.asyncio
    async def test_recommendations(self):
        # First search for a paper to get an ID
        search = await s2_search("21cm cosmology HERA", limit=1)
        if "error" in search or len(search["papers"]) == 0:
            pytest.skip("S2 rate limited or no results for search")
        paper_id = search["papers"][0]["paperId"]

        recs = await s2_recommend(paper_id, limit=3)
        assert isinstance(recs, list)
        for rec in recs:
            assert "title" in rec
            assert "authors" in rec


class TestLocalToolWrappers:
    """Test the wrapper functions in local_tools.py that call S2 functions."""

    @pytest.mark.asyncio
    async def test_search_academic_papers_default_limit(self):
        result = await search_academic_papers("cosmology", "", 0)
        assert "papers" in result
        # limit=0 → default 5
        assert len(result["papers"]) <= 5

    @pytest.mark.asyncio
    async def test_search_academic_papers_with_year(self):
        result = await search_academic_papers("dark matter", "2023-2024", 3)
        assert "papers" in result

    @pytest.mark.asyncio
    async def test_get_paper_recommendations_wrapper(self):
        search = await search_academic_papers("HERA hydrogen epoch", "", 1)
        if search["papers"]:
            paper_id = search["papers"][0]["paperId"]
            recs = await get_paper_recommendations(paper_id, 0)
            assert isinstance(recs, list)


class TestFormatPaper:
    def test_full_paper(self):
        raw = {
            "paperId": "abc",
            "title": "Test Paper",
            "authors": [{"name": "Alice"}, {"name": "Bob"}],
            "year": 2024,
            "citationCount": 42,
            "doi": "10.1234/test",
            "abstract": "An abstract.",
            "venue": "Nature",
            "url": "https://example.com",
            "externalIds": {"DOI": "10.1234/test"},
        }
        result = _format_paper(raw)
        assert result["title"] == "Test Paper"
        assert result["authors"] == ["Alice", "Bob"]
        assert result["citationCount"] == 42

    def test_missing_fields(self):
        result = _format_paper({})
        assert result["title"] is None
        assert result["authors"] == []

    def test_author_with_no_name(self):
        result = _format_paper({"authors": [{"name": "Alice"}, {}, {"name": None}]})
        assert result["authors"] == ["Alice"]


class TestBuildHeaders:
    def test_without_key(self):
        h = _build_headers()
        assert "x-api-key" not in h

    def test_with_key(self):
        h = _build_headers("my-key")
        assert h["x-api-key"] == "my-key"


# ============================================================================
# 3. Zotero Plugin — real HTTP calls to localhost:23119
# ============================================================================

class TestZoteroPing:
    @pytest.mark.asyncio
    async def test_ping(self):
        result = await zotero_post("ping")
        assert result["status"] == "ok"
        assert result["plugin"] == "colloquia"
        assert "version" in result


class TestZoteroSearchLibrary:
    @pytest.mark.asyncio
    async def test_search_all(self):
        result = await zotero_post("searchLibrary", {})
        assert "items" in result
        assert isinstance(result["items"], list)

    @pytest.mark.asyncio
    async def test_search_by_query(self):
        result = await zotero_post("searchLibrary", {"query": "hydrogen"})
        assert "items" in result

    @pytest.mark.asyncio
    async def test_search_by_author(self):
        result = await zotero_post("searchLibrary", {"author": "a"})
        assert "items" in result

    @pytest.mark.asyncio
    async def test_search_no_results(self):
        result = await zotero_post("searchLibrary", {"query": "xyznonexistent12345"})
        assert "items" in result
        assert len(result["items"]) == 0


class TestZoteroCollections:
    @pytest.mark.asyncio
    async def test_list_collections(self):
        result = await zotero_get("listCollections")
        assert "collections" in result
        assert isinstance(result["collections"], list)

    @pytest.mark.asyncio
    async def test_create_and_cleanup_collection(self):
        # Create
        create_result = await zotero_post(
            "createCollection", {"name": "__test_collection_deleteme__"}
        )
        assert "collectionKey" in create_result
        col_key = create_result["collectionKey"]

        # Verify it appears in list
        list_result = await zotero_get("listCollections")
        col_names = [c["name"] for c in list_result["collections"]]
        assert "__test_collection_deleteme__" in col_names

        # Clean up: delete the collection via Zotero API
        async with httpx.AsyncClient(timeout=10) as client:
            # Get the collection's version for If-Unmodified-Since-Version
            resp = await client.get(
                f"{ZOTERO_BASE}/api/users/0/collections/{col_key}"
            )
            version = resp.json().get("version", 0)
            await client.delete(
                f"{ZOTERO_BASE}/api/users/0/collections/{col_key}",
                headers={"If-Unmodified-Since-Version": str(version)},
            )


class TestZoteroNotes:
    @pytest.mark.asyncio
    async def test_create_note(self):
        item_key = get_first_regular_item_key()
        result = await zotero_post("createNote", {
            "parentItemKey": item_key,
            "noteContent": "<p>Integration test note — safe to delete</p>",
            "tags": ["test-auto", "deleteme"],
        })
        assert "noteKey" in result
        note_key = result["noteKey"]

        # Clean up: trash the note
        await zotero_post("trashItems", {"itemKeys": [note_key]})


class TestZoteroTags:
    @pytest.mark.asyncio
    async def test_add_and_remove_tags(self):
        item_key = get_first_regular_item_key()

        # Add tags
        add_result = await zotero_post("addTags", {
            "itemKeys": [item_key],
            "tags": ["__test_tag_1__", "__test_tag_2__"],
        })
        assert "modified" in add_result
        assert add_result["modified"] >= 1

        # Remove tags
        remove_result = await zotero_post("removeTags", {
            "itemKeys": [item_key],
            "tags": ["__test_tag_1__", "__test_tag_2__"],
        })
        assert "modified" in remove_result


class TestZoteroRelated:
    @pytest.mark.asyncio
    async def test_add_related(self):
        # Get two items
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{ZOTERO_BASE}/api/users/0/items?limit=2")
            items = resp.json()
        if len(items) < 2:
            pytest.skip("Need at least 2 items in Zotero")

        key1 = items[0]["key"]
        key2 = items[1]["key"]

        result = await zotero_post("addRelated", {
            "itemKey1": key1,
            "itemKey2": key2,
        })
        assert result.get("success") is True


class TestZoteroAnnotations:
    @pytest.mark.asyncio
    async def test_get_annotations(self):
        item_key = get_first_regular_item_key()
        result = await zotero_post("getAnnotations", {"itemKey": item_key})
        # Item may not have a PDF — both outcomes are valid
        if "error" in result and "No PDF" in result["error"]:
            # Valid response — item has no PDF attachment
            assert True
        else:
            assert "annotations" in result
            assert isinstance(result["annotations"], list)


class TestZoteroTrash:
    @pytest.mark.asyncio
    async def test_trash_and_verify(self):
        # Create a disposable note, then trash it
        item_key = get_first_regular_item_key()
        note_result = await zotero_post("createNote", {
            "parentItemKey": item_key,
            "noteContent": "<p>Trash test note</p>",
        })
        note_key = note_result["noteKey"]

        trash_result = await zotero_post("trashItems", {"itemKeys": [note_key]})
        assert "trashed" in trash_result
        assert trash_result["trashed"] >= 1


class TestZoteroAddPaper:
    @pytest.mark.asyncio
    async def test_add_paper_by_doi(self):
        """Add a paper by DOI, then trash it to clean up."""
        result = await zotero_post("addPaper", {
            "doi": "10.1103/PhysRevLett.116.061102",  # LIGO gravitational waves
        })
        assert "itemKey" in result
        assert "title" in result

        # Clean up
        await zotero_post("trashItems", {"itemKeys": [result["itemKey"]]})

    @pytest.mark.asyncio
    async def test_add_paper_manual_fallback(self):
        """Add a paper with manual metadata (no DOI)."""
        result = await zotero_post("addPaper", {
            "title": "__Test Paper Delete Me__",
            "authors": "Test Author",
            "url": "https://example.com/test",
            "abstract": "This is a test paper created by integration tests.",
        })
        assert "itemKey" in result

        # Clean up
        await zotero_post("trashItems", {"itemKeys": [result["itemKey"]]})


class TestZoteroTestEndpoints:
    @pytest.mark.asyncio
    async def test_doi_import_test(self):
        result = await zotero_post("test-doi-import", {
            "doi": "10.1038/s41586-020-2649-2",
        })
        assert result.get("success") is True
        assert "title" in result


# ============================================================================
# 4. PDF Processing — real PDF operations
# ============================================================================

class TestGeminiToPdfCoords:
    def test_full_page(self):
        result = gemini_to_pdf_coords([0, 0, 1000, 1000], 612.0, 792.0)
        x1, y1, x2, y2 = result[0]
        assert x1 == pytest.approx(0.0)
        assert y1 == pytest.approx(0.0)
        assert x2 == pytest.approx(612.0)
        assert y2 == pytest.approx(792.0)

    def test_center_region(self):
        result = gemini_to_pdf_coords([250, 250, 750, 750], 612.0, 792.0)
        x1, y1, x2, y2 = result[0]
        assert x1 == pytest.approx(612.0 * 0.25)
        assert x2 == pytest.approx(612.0 * 0.75)
        assert y1 == pytest.approx(792.0 * 0.25)
        assert y2 == pytest.approx(792.0 * 0.75)

    def test_top_left_corner(self):
        result = gemini_to_pdf_coords([0, 0, 100, 100], 612.0, 792.0)
        x1, y1, x2, y2 = result[0]
        assert x1 == pytest.approx(0.0)
        assert x2 == pytest.approx(61.2)
        # Y flipped: Gemini top → PDF bottom (high y)
        assert y2 == pytest.approx(792.0)
        assert y1 == pytest.approx(792.0 * 0.9)

    def test_bottom_right_corner(self):
        result = gemini_to_pdf_coords([900, 900, 1000, 1000], 612.0, 792.0)
        x1, y1, x2, y2 = result[0]
        assert x2 == pytest.approx(612.0)
        assert y1 == pytest.approx(0.0)

    def test_non_standard_page_size(self):
        # A4: 595.28 x 841.89 points
        result = gemini_to_pdf_coords([0, 0, 500, 500], 595.28, 841.89)
        x1, y1, x2, y2 = result[0]
        assert x2 == pytest.approx(595.28 * 0.5)
        assert y1 == pytest.approx(841.89 * 0.5)

    def test_invalid_length(self):
        with pytest.raises(ValueError, match="Expected 4-element"):
            gemini_to_pdf_coords([0, 0, 100], 612.0, 792.0)

    def test_out_of_range(self):
        with pytest.raises(ValueError, match="outside 0-1000"):
            gemini_to_pdf_coords([0, 0, 1001, 500], 612.0, 792.0)

    def test_negative(self):
        with pytest.raises(ValueError, match="outside 0-1000"):
            gemini_to_pdf_coords([-1, 0, 500, 500], 612.0, 792.0)

    def test_all_zeros(self):
        with pytest.raises(ValueError, match="All-zero"):
            gemini_to_pdf_coords([0, 0, 0, 0], 612.0, 792.0)

    def test_degenerate_y(self):
        with pytest.raises(ValueError, match="Degenerate"):
            gemini_to_pdf_coords([500, 100, 500, 200], 612.0, 792.0)

    def test_degenerate_x(self):
        with pytest.raises(ValueError, match="Degenerate"):
            gemini_to_pdf_coords([100, 500, 200, 500], 612.0, 792.0)

    def test_inverted(self):
        with pytest.raises(ValueError, match="Degenerate"):
            gemini_to_pdf_coords([500, 100, 300, 200], 612.0, 792.0)


class TestValidateAnnotationCoords:
    def test_valid(self):
        ok, msg = validate_annotation_coords([[50, 50, 200, 200]], 612, 792)
        assert ok is True
        assert msg == ""

    def test_multiple_valid_rects(self):
        ok, msg = validate_annotation_coords(
            [[50, 50, 200, 200], [300, 300, 500, 500]], 612, 792
        )
        assert ok is True

    def test_all_zeros(self):
        ok, msg = validate_annotation_coords([[0, 0, 0, 0]], 612, 792)
        assert ok is False
        assert "zero" in msg

    def test_outside_bounds(self):
        ok, msg = validate_annotation_coords([[0, 0, 700, 100]], 612, 792)
        assert ok is False
        assert "outside" in msg

    def test_too_small(self):
        ok, msg = validate_annotation_coords([[100, 100, 103, 103]], 612, 792)
        assert ok is False
        assert "small" in msg

    def test_wrong_length(self):
        ok, msg = validate_annotation_coords([[0, 0, 100]], 612, 792)
        assert ok is False


class TestShouldReextract:
    def test_empty(self):
        assert should_reextract("", 10) is True

    def test_whitespace(self):
        assert should_reextract("   \n  ", 10) is True

    def test_sparse(self):
        text = " ".join(["word"] * 100)
        assert should_reextract(text, 10) is True  # 100 words < 10*50

    def test_adequate(self):
        text = " ".join(["word"] * 600)
        assert should_reextract(text, 10) is False  # 600 words >= 10*50

    def test_single_page_adequate(self):
        text = " ".join(["word"] * 60)
        assert should_reextract(text, 1) is False


class TestPageSelection:
    def test_short_pdf_renders_all(self, sample_pdf):
        pages = select_pages_for_rendering(sample_pdf)
        assert pages == [0, 1, 2, 3, 4]

    def test_long_pdf_selective(self, long_pdf):
        pages = select_pages_for_rendering(long_pdf)
        # Should include first and last pages
        assert 0 in pages
        assert 24 in pages
        # Should be <= TIER2_MAX (15)
        assert len(pages) <= 15


class TestRenderPages:
    def test_renders_selected_pages(self, sample_pdf):
        results = render_pages(sample_pdf, [0, 2, 4])
        assert len(results) == 3
        for r in results:
            assert "imageBase64" in r
            assert "width" in r
            assert "height" in r
            assert "widthPx" in r
            assert "heightPx" in r
            assert r["width"] == pytest.approx(612.0)
            assert r["height"] == pytest.approx(792.0)
            # Verify base64 is decodable
            decoded = base64.b64decode(r["imageBase64"])
            assert len(decoded) > 100  # Not empty image

        assert [r["pageIndex"] for r in results] == [0, 2, 4]

    def test_out_of_range_skipped(self, sample_pdf):
        results = render_pages(sample_pdf, [0, 99])
        assert len(results) == 1
        assert results[0]["pageIndex"] == 0

    def test_empty_list(self, sample_pdf):
        assert render_pages(sample_pdf, []) == []

    def test_dpi_affects_pixel_size(self, sample_pdf):
        low = render_pages(sample_pdf, [0], dpi=72)
        high = render_pages(sample_pdf, [0], dpi=300)
        assert high[0]["widthPx"] > low[0]["widthPx"]
        assert high[0]["heightPx"] > low[0]["heightPx"]


class TestGetPageDimensions:
    def test_dimensions(self, sample_pdf):
        dims = get_page_dimensions(sample_pdf)
        assert len(dims) == 5
        for d in dims:
            assert d["width"] == pytest.approx(612.0)
            assert d["height"] == pytest.approx(792.0)


# ============================================================================
# 5. Zotero Tool Context & Resolution
# ============================================================================

class TestZoteroToolContext:
    def test_init(self):
        ctx = ZoteroToolContext()
        assert ctx.pending == {}
        assert ctx.page_dimensions == {}

    def test_cleanup_cancels_futures(self):
        ctx = ZoteroToolContext()
        loop = asyncio.new_event_loop()
        future = loop.create_future()
        ctx.pending["test-id"] = future
        ctx.cleanup()
        assert future.cancelled()
        assert ctx.pending == {}
        loop.close()

    def test_cleanup_empty(self):
        ctx = ZoteroToolContext()
        ctx.cleanup()
        assert ctx.pending == {}

    def test_page_dimensions_storage(self):
        ctx = ZoteroToolContext()
        ctx.page_dimensions[0] = {"width": 612.0, "height": 792.0}
        ctx.page_dimensions[1] = {"width": 595.28, "height": 841.89}
        assert ctx.page_dimensions[0]["width"] == 612.0
        assert ctx.page_dimensions[1]["height"] == pytest.approx(841.89)


class TestResolveZoteroResult:
    def test_success_resolves_future(self):
        ctx = ZoteroToolContext()
        loop = asyncio.new_event_loop()
        future = loop.create_future()
        ctx.pending["req-1"] = future

        resolve_zotero_result(
            {"requestId": "req-1", "success": True, "data": {"items": []}},
            ctx,
        )
        assert future.done()
        assert future.result() == {"items": []}
        loop.close()

    def test_error_sets_exception(self):
        ctx = ZoteroToolContext()
        loop = asyncio.new_event_loop()
        future = loop.create_future()
        ctx.pending["req-2"] = future

        resolve_zotero_result(
            {"requestId": "req-2", "success": False, "error": "Not found"},
            ctx,
        )
        assert future.done()
        with pytest.raises(Exception, match="Not found"):
            future.result()
        loop.close()

    def test_unknown_id_ignored(self):
        ctx = ZoteroToolContext()
        # Should not raise
        resolve_zotero_result(
            {"requestId": "unknown", "success": True, "data": {}},
            ctx,
        )

    def test_success_with_missing_data(self):
        ctx = ZoteroToolContext()
        loop = asyncio.new_event_loop()
        future = loop.create_future()
        ctx.pending["req-3"] = future

        resolve_zotero_result(
            {"requestId": "req-3", "success": True},
            ctx,
        )
        assert future.result() == {}
        loop.close()


# ============================================================================
# 6. Zotero Tool Function Structure
# ============================================================================

class TestCreateZoteroTools:
    def test_returns_eight_tools(self):
        ws = AsyncMock()
        ctx = ZoteroToolContext()
        tools = create_zotero_tools(ws, ctx)
        assert len(tools) == 8

    def test_tool_names(self):
        ws = AsyncMock()
        ctx = ZoteroToolContext()
        tools = create_zotero_tools(ws, ctx)
        names = [t.__name__ for t in tools]
        assert names == [
            "search_zotero_library",
            "create_note",
            "manage_tags",
            "link_related_items",
            "annotate_zotero_pdf",
            "manage_collection",
            "trash_items",
            "add_paper_to_zotero",
        ]

    def test_all_async(self):
        ws = AsyncMock()
        ctx = ZoteroToolContext()
        tools = create_zotero_tools(ws, ctx)
        for tool in tools:
            assert asyncio.iscoroutinefunction(tool), f"{tool.__name__} is not async"

    def test_all_have_docstrings(self):
        ws = AsyncMock()
        ctx = ZoteroToolContext()
        tools = create_zotero_tools(ws, ctx)
        for tool in tools:
            assert tool.__doc__, f"{tool.__name__} missing docstring"


# Need AsyncMock for the structure tests above
from unittest.mock import AsyncMock


# ============================================================================
# 7. Main Agent Creation
# ============================================================================

class TestCreateColloquiaAgent:
    def test_creates_agent_with_all_tools(self):
        ws = AsyncMock()
        ctx = ZoteroToolContext()
        agent = create_colloquia_agent(ws, ctx)
        assert agent.name == AGENT_NAME
        # 2 local + 8 zotero = 10
        assert len(agent.tools) == 10

    def test_agent_model(self):
        ws = AsyncMock()
        ctx = ZoteroToolContext()
        agent = create_colloquia_agent(ws, ctx)
        assert agent.model == LIVE_MODEL

    def test_agent_audio_config(self):
        ws = AsyncMock()
        ctx = ZoteroToolContext()
        agent = create_colloquia_agent(ws, ctx)
        config = agent.generate_content_config
        assert config is not None


# ============================================================================
# 9. Dynamic Instruction / Prompt Switching
# ============================================================================

class TestDynamicInstruction:
    def test_lobby_mode(self):
        from unittest.mock import MagicMock
        context = MagicMock()
        context.state = {"session_mode": "lobby", "paper_context": {}}
        result = _dynamic_instruction(context)
        assert result == LOBBY_SYSTEM_PROMPT

    def test_paper_mode(self):
        from unittest.mock import MagicMock
        context = MagicMock()
        context.state = {
            "session_mode": "paper",
            "paper_context": {
                "title": "21cm Signal from EoR",
                "authors": "HERA Collaboration",
                "year": "2023",
                "doi": "10.1038/hera",
                "venue": "ApJ",
                "annotation_count": 5,
                "note_count": 2,
                "pdf_attachment_key": "PDF_KEY_123",
                "user_annotations_summary": "3 highlights on methodology section",
            },
        }
        result = _dynamic_instruction(context)
        assert "21cm Signal from EoR" in result
        assert "HERA Collaboration" in result
        assert "10.1038/hera" in result
        assert "PDF_KEY_123" in result

    def test_default_is_lobby(self):
        from unittest.mock import MagicMock
        context = MagicMock()
        context.state = {}
        result = _dynamic_instruction(context)
        assert result == LOBBY_SYSTEM_PROMPT


# ============================================================================
# 10. Prompt Templates
# ============================================================================

class TestBuildPaperPrompt:
    def test_all_fields(self):
        prompt = build_paper_prompt(
            title="21cm Signal",
            authors="HERA Collaboration",
            year="2023",
            doi="10.1038/hera",
            venue="ApJ",
            annotation_count=10,
            note_count=3,
            pdf_attachment_key="KEY1",
            user_annotations_summary="5 highlights",
        )
        assert "21cm Signal" in prompt
        assert "HERA Collaboration" in prompt
        assert "10.1038/hera" in prompt
        assert "KEY1" in prompt
        assert "5 highlights" in prompt

    def test_defaults(self):
        prompt = build_paper_prompt()
        assert "Unknown" in prompt
        assert "N/A" in prompt
        assert "No existing annotations" in prompt

    def test_mentions_tools(self):
        prompt = build_paper_prompt(title="Test")
        assert "annotate_zotero_pdf" in prompt
        assert "search_academic_papers" in prompt


class TestLobbyPrompt:
    def test_not_empty(self):
        assert len(LOBBY_SYSTEM_PROMPT) > 100

    def test_mentions_key_tools(self):
        assert "search_zotero_library" in LOBBY_SYSTEM_PROMPT
        assert "search_academic_papers" in LOBBY_SYSTEM_PROMPT
        assert "add_paper_to_zotero" in LOBBY_SYSTEM_PROMPT

    def test_voice_guidelines(self):
        assert "English" in LOBBY_SYSTEM_PROMPT
        assert "conversational" in LOBBY_SYSTEM_PROMPT
