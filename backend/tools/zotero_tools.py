"""Zotero tools — frontend-delegated via WebSocket.

Factory creates 8 async tool functions per session, each closing over
the WebSocket for delegation to the Zotero plugin running on the user's machine.
"""

import asyncio
import logging
import uuid
from typing import Any

from fastapi import WebSocket

from config import ZOTERO_TIMEOUT

logger: logging.Logger = logging.getLogger(__name__)


class ToolError(Exception):
    """Raised when a tool call fails."""
    pass


class ZoteroToolContext:
    """Per-session state for Zotero tool delegation."""

    def __init__(self) -> None:
        self.pending: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self.page_dimensions: dict[int, dict[str, float]] = {}

    def cleanup(self) -> None:
        """Cancel all pending futures."""
        for future in self.pending.values():
            if not future.done():
                future.cancel()
        self.pending.clear()


async def _delegate_to_frontend(
    ws: WebSocket,
    action: str,
    params: dict[str, Any],
    ctx: ZoteroToolContext,
) -> dict[str, Any]:
    """Send a Zotero action to the frontend, wait for result."""
    request_id: str = str(uuid.uuid4())
    loop: asyncio.AbstractEventLoop = asyncio.get_running_loop()
    future: asyncio.Future[dict[str, Any]] = loop.create_future()
    ctx.pending[request_id] = future

    await ws.send_json({
        "type": "zotero_action",
        "requestId": request_id,
        "action": action,
        "params": params,
    })

    try:
        result: dict[str, Any] = await asyncio.wait_for(future, timeout=ZOTERO_TIMEOUT)
        return result
    except asyncio.TimeoutError:
        raise ToolError(
            f"Zotero plugin didn't respond within {ZOTERO_TIMEOUT}s — "
            f"is Zotero running? Is the tab in the foreground?"
        )
    finally:
        ctx.pending.pop(request_id, None)


def resolve_zotero_result(msg: dict[str, Any], ctx: ZoteroToolContext) -> None:
    """Called when the frontend sends a zotero_action_result message."""
    request_id: str = msg["requestId"]
    future: asyncio.Future[dict[str, Any]] | None = ctx.pending.get(request_id)
    if future and not future.done():
        if msg.get("success"):
            future.set_result(msg.get("data", {}))
        else:
            future.set_exception(
                ToolError(msg.get("error", "Unknown Zotero error"))
            )


def create_zotero_tools(
    ws: WebSocket,
    ctx: ZoteroToolContext,
) -> list[Any]:
    """Create Zotero tool functions bound to a specific WebSocket session.

    Returns a list of async callables suitable for ADK FunctionTool wrapping.
    """
    from tools.pdf_processing import gemini_to_pdf_coords, validate_annotation_coords

    async def search_zotero_library(
        query: str = "", tag: str = "", collection: str = "", author: str = "",
        year: str = "", itemType: str = "",
        limit: int = 20, offset: int = 0,
        detail: str = "minimal",
        maxAuthors: int = 0, maxAbstractChars: int = 0, maxTags: int = 0,
        sort: str = "", sortDirection: str = "desc",
    ) -> dict[str, Any]:
        """Search the user's Zotero library for papers by title, author, tag, or collection.

        Uses detail levels to control how much data is returned, reducing context pollution.
        Start with detail="minimal" and only upgrade when the user needs more data.

        Args:
            query: Search text matching title, creator, or year. Pass empty string to skip.
            tag: Filter by tag name. Pass empty string to skip.
            collection: Filter by collection key or name (case-insensitive). Pass empty string to skip.
            author: Filter by author name. Pass empty string to skip.
            year: Filter by year: "2023" (single year) or "2020-2024" (range). Pass empty string to skip.
            itemType: Filter by item type (e.g. "journalArticle", "conferencePaper"). Pass empty string to skip.
            limit: Maximum number of items to return (1-50).
            offset: Number of items to skip for pagination.
            detail: Data detail level: "minimal" (title+year+3 authors), "standard" (adds abstract snippet, DOI), "full" (everything). Default "minimal".
            maxAuthors: Override max authors per item (0=use detail default, positive=cap, -1=all).
            maxAbstractChars: Override abstract truncation (0=use detail default, positive=char limit, -1=full).
            maxTags: Override max tags per item (0=use detail default, positive=cap, -1=all).
            sort: Sort field: "date", "title", "dateAdded", "dateModified". Pass empty string for default order.
            sortDirection: Sort direction: "asc" or "desc". Default "desc".
        """
        from tools.result_processing import compact_search_results

        # Strip wildcards/whitespace so Gemini sending "*" or " " is treated
        # the same as an empty string (i.e. no filter applied).
        def _clean(val: str) -> str:
            return val.strip().strip("*").strip()

        params: dict[str, Any] = {}
        if _clean(query):
            params["query"] = _clean(query)
        if _clean(tag):
            params["tag"] = _clean(tag)
        if _clean(collection):
            params["collection"] = _clean(collection)
        if _clean(author):
            params["author"] = _clean(author)
        if _clean(year):
            params["year"] = _clean(year)
        if _clean(itemType):
            params["itemType"] = _clean(itemType)
        params["limit"] = max(1, min(limit, 50))
        params["offset"] = max(0, offset)
        if _clean(sort):
            params["sort"] = _clean(sort)
            params["sortDirection"] = sortDirection if sortDirection in ("asc", "desc") else "desc"

        # Always request all fields from plugin; backend post-processing compacts
        raw_result: dict[str, Any] = await _delegate_to_frontend(ws, "searchLibrary", params, ctx)

        # Validate detail level
        valid_details: list[str] = ["minimal", "standard", "full"]
        effective_detail: str = detail if detail in valid_details else "minimal"

        return compact_search_results(
            raw_result,
            detail=effective_detail,
            maxAuthors=maxAuthors,
            maxAbstractChars=maxAbstractChars,
            maxTags=maxTags,
        )

    async def create_note(parentItemKey: str, noteContent: str, tags: str) -> dict[str, Any]:
        """Create a note attached to a paper in Zotero.

        Use this to save discussion insights, analysis, or summaries.

        Args:
            parentItemKey: Zotero item key of the parent paper.
            noteContent: HTML content for the note.
            tags: Comma-separated tags to add to the note. Pass empty string for no tags.
        """
        params: dict[str, Any] = {
            "parentItemKey": parentItemKey,
            "noteContent": noteContent,
        }
        if tags:
            params["tags"] = [t.strip() for t in tags.split(",")]
        return await _delegate_to_frontend(ws, "createNote", params, ctx)

    async def manage_tags(action: str, itemKeys: str, tags: str) -> dict[str, Any]:
        """Add or remove tags on one or more Zotero items.

        Always confirm with the user before applying.

        Args:
            action: 'add' or 'remove'.
            itemKeys: Comma-separated Zotero item keys to modify.
            tags: Comma-separated tags to add or remove.
        """
        endpoint: str = "addTags" if action == "add" else "removeTags"
        params: dict[str, Any] = {
            "itemKeys": [k.strip() for k in itemKeys.split(",")],
            "tags": [t.strip() for t in tags.split(",")],
        }
        return await _delegate_to_frontend(ws, endpoint, params, ctx)

    async def link_related_items(itemKey1: str, itemKey2: str) -> dict[str, Any]:
        """Create a bidirectional 'related' link between two papers in Zotero.

        Args:
            itemKey1: First item key.
            itemKey2: Second item key.
        """
        return await _delegate_to_frontend(
            ws, "addRelated", {"itemKey1": itemKey1, "itemKey2": itemKey2}, ctx
        )

    async def annotate_zotero_pdf(
        parentItemKey: str,
        annotationType: str,
        pageIndex: int,
        boundingBox_ymin: int,
        boundingBox_xmin: int,
        boundingBox_ymax: int,
        boundingBox_xmax: int,
        comment: str,
    ) -> dict[str, Any]:
        """Create a visual annotation on the PDF in Zotero's reader.

        Use this when discussing a specific figure, equation, table, or text region
        to highlight it for the user. Annotations appear live in Zotero.

        Args:
            parentItemKey: Zotero item key of the PDF attachment or parent item.
            annotationType: Type of annotation: 'highlight', 'image', or 'note'.
            pageIndex: Zero-indexed page number.
            boundingBox_ymin: Top edge in 0-1000 coordinate space.
            boundingBox_xmin: Left edge in 0-1000 coordinate space.
            boundingBox_ymax: Bottom edge in 0-1000 coordinate space.
            boundingBox_xmax: Right edge in 0-1000 coordinate space.
            comment: Text comment for the annotation.
        """
        bbox: list[int] = [boundingBox_ymin, boundingBox_xmin, boundingBox_ymax, boundingBox_xmax]

        # Use stored page dimensions or defaults (8.5x11 inches)
        page_width: float = ctx.page_dimensions.get(pageIndex, {}).get("width", 612.0)
        page_height: float = ctx.page_dimensions.get(pageIndex, {}).get("height", 792.0)

        # Validate
        is_valid: bool
        validation_msg: str
        is_valid, validation_msg = validate_annotation_coords([bbox], page_width, page_height)
        if not is_valid:
            return {"error": f"Invalid annotation coordinates: {validation_msg}"}

        pdf_rects: list[list[float]] = gemini_to_pdf_coords(bbox, page_width, page_height)
        params: dict[str, Any] = {
            "parentItemKey": parentItemKey,
            "annotationType": annotationType,
            "pageIndex": pageIndex,
            "rects": pdf_rects,
            "comment": comment,
        }
        return await _delegate_to_frontend(ws, "createAnnotation", params, ctx)

    async def manage_collection(action: str, name: str = "", collectionKey: str = "", itemKeys: str = "", parentCollectionKey: str = "") -> dict[str, Any]:
        """Manage Zotero collections: list, create, add items, or remove items.

        Always confirm with the user before modifying.

        Args:
            action: 'list', 'create', 'addItems', or 'removeItems'.
            name: Collection name (for 'create' action). Pass empty string to skip.
            collectionKey: Collection key (for addItems/removeItems). Pass empty string to skip.
            itemKeys: Comma-separated item keys (for addItems/removeItems). Pass empty string to skip.
            parentCollectionKey: Parent collection key (for 'create', optional). Pass empty string to skip.
        """
        action_map: dict[str, str] = {
            "list": "listCollections",
            "create": "createCollection",
            "addItems": "addToCollection",
            "removeItems": "removeFromCollection",
        }
        endpoint = action_map.get(action, "listCollections")
        params: dict[str, Any] = {}
        if name:
            params["name"] = name
        if collectionKey:
            params["collectionKey"] = collectionKey
        if itemKeys:
            params["itemKeys"] = [k.strip() for k in itemKeys.split(",")]
        if parentCollectionKey:
            params["parentCollectionKey"] = parentCollectionKey
        return await _delegate_to_frontend(ws, endpoint, params, ctx)

    async def trash_items(itemKeys: str) -> dict[str, Any]:
        """Move Zotero items to the trash. This is recoverable.

        Always confirm with the user before trashing items.

        Args:
            itemKeys: Comma-separated Zotero item keys to move to trash.
        """
        keys: list[str] = [k.strip() for k in itemKeys.split(",")]
        return await _delegate_to_frontend(ws, "trashItems", {"itemKeys": keys}, ctx)

    async def add_paper_to_zotero(doi: str = "", title: str = "", authors: str = "", url: str = "", abstract: str = "", collectionKey: str = "") -> dict[str, Any]:
        """Add a discovered paper to the user's Zotero library.

        Provide a DOI for best results (automatic metadata lookup).
        Always confirm with the user before adding.

        Args:
            doi: Paper DOI for automatic metadata import. Pass empty string if unavailable.
            title: Paper title (fallback if DOI lookup fails). Pass empty string to skip.
            authors: Comma-separated author names (fallback). Pass empty string to skip.
            url: Paper URL (fallback). Pass empty string to skip.
            abstract: Paper abstract (fallback). Pass empty string to skip.
            collectionKey: Optional Zotero collection key to add the paper to. Pass empty string to skip.
        """
        params: dict[str, Any] = {}
        if doi:
            params["doi"] = doi
        if title:
            params["title"] = title
        if authors:
            params["authors"] = authors
        if url:
            params["url"] = url
        if abstract:
            params["abstract"] = abstract
        if collectionKey:
            params["collectionKey"] = collectionKey
        return await _delegate_to_frontend(ws, "addPaper", params, ctx)

    async def get_item_details(itemKey: str) -> dict[str, Any]:
        """Get complete metadata for a specific Zotero item by its key.

        Use this after search_zotero_library to get full details about a paper
        the user is interested in. Returns all metadata fields, child item counts,
        collections, and related items.

        Args:
            itemKey: The Zotero item key (e.g., from a previous search result).
        """
        return await _delegate_to_frontend(ws, "getItem", {"itemKey": itemKey}, ctx)

    async def get_paper_fulltext(itemKey: str, maxChars: int = 0) -> dict[str, Any]:
        """Read the full text content of a paper from its PDF in Zotero.

        Use this when the user asks you to read, explain, or discuss specific
        sections of a paper (introduction, methods, results, etc.). Returns the
        extracted text from the PDF attachment.

        Pass the parent item key (from search results); the frontend will
        automatically find the PDF attachment and extract its text.

        Args:
            itemKey: The Zotero item key of the paper (parent item, not PDF attachment).
            maxChars: Maximum characters to return (0 = full text, up to 100k). Useful for getting just the beginning of a paper.
        """
        result: dict[str, Any] = await _delegate_to_frontend(
            ws, "getFulltext", {"itemKey": itemKey}, ctx
        )
        content: str = result.get("content", "")
        if not content:
            return {"error": "No full text available. The paper may not have a PDF attachment, or the PDF has not been indexed by Zotero yet."}

        effective_max: int = maxChars if maxChars > 0 else 100_000
        if len(content) > effective_max:
            content = content[:effective_max] + "\n\n[... text truncated ...]"

        return {
            "content": content,
            "totalChars": result.get("totalChars", len(content)),
            "indexedPages": result.get("indexedPages"),
            "totalPages": result.get("totalPages"),
        }

    return [
        search_zotero_library,
        get_item_details,
        get_paper_fulltext,
        create_note,
        manage_tags,
        link_related_items,
        annotate_zotero_pdf,
        manage_collection,
        trash_items,
        add_paper_to_zotero,
    ]
