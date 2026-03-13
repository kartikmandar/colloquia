"""Vector search tools — semantic search + indexing for ADK agent.

Factory functions create tool closures that capture the EmbeddingService
instance. ADK limitation: all params must be required (no defaults).
"""

import logging
from typing import Any, Callable

from fastapi import WebSocket

from tools.embedding_service import EmbeddingService
from tools.zotero_tools import ZoteroToolContext, _delegate_to_frontend

logger: logging.Logger = logging.getLogger(__name__)


def create_semantic_search_tool(
    service: EmbeddingService,
) -> Callable[..., Any]:
    """Create a semantic search tool bound to an EmbeddingService."""

    async def semantic_search_library(
        query: str, max_results: str = "", paper_key: str = ""
    ) -> dict[str, Any]:
        """Search the Zotero library by meaning using vector similarity.

        Uses embeddings to find semantically similar passages across all
        indexed papers. More powerful than keyword search for conceptual queries.

        Args:
            query: Natural language query describing what you're looking for.
            max_results: Maximum results to return (default 10). Pass empty string for default.
            paper_key: Restrict search to a specific paper's item key. Pass empty string to search all.
        """
        n: int = 10
        if max_results and max_results.strip():
            try:
                n = int(max_results)
            except ValueError:
                n = 10

        key: str | None = paper_key.strip() if paper_key and paper_key.strip() else None

        try:
            hits: list[dict[str, Any]] = await service.search(
                query=query, n_results=n, item_key=key
            )
            if not hits:
                return {
                    "results": [],
                    "message": "No semantic matches found. Papers may not be indexed yet. "
                    "Try asking me to index your library first.",
                }
            return {
                "results": hits,
                "total": len(hits),
            }
        except Exception as e:
            logger.error("Semantic search failed: %s", str(e))
            return {"error": f"Semantic search failed: {str(e)}"}

    return semantic_search_library


def create_index_tool(
    service: EmbeddingService,
    ws: WebSocket,
    ctx: ZoteroToolContext,
) -> Callable[..., Any]:
    """Create an indexing tool bound to an EmbeddingService and WebSocket."""

    async def index_library_papers(
        item_keys: str, force: str = ""
    ) -> dict[str, Any]:
        """Index papers from the Zotero library for semantic search.

        Fetches paper metadata and full text, then creates embeddings
        for vector search. Already-indexed papers are skipped unless forced.

        Args:
            item_keys: Comma-separated Zotero item keys to index. Use 'all' to index recent papers.
            force: Set to 'true' to re-index already-indexed papers. Pass empty string to skip re-indexing.
        """
        force_reindex: bool = force.strip().lower() == "true"
        keys: list[str] = [k.strip() for k in item_keys.split(",") if k.strip()]

        if not keys:
            return {"error": "No item keys provided"}

        results: list[dict[str, Any]] = []
        for key in keys[:20]:  # Cap at 20 papers per call
            try:
                # Skip if already indexed (unless forced)
                if not force_reindex and await service.is_indexed(key):
                    results.append({
                        "item_key": key,
                        "status": "already_indexed",
                    })
                    continue

                # Fetch metadata via Zotero plugin
                meta: dict[str, Any] = await _delegate_to_frontend(
                    ws, "getItem", {"itemKey": key}, ctx
                )

                # Fetch full text
                fulltext_result: dict[str, Any] = await _delegate_to_frontend(
                    ws, "getFulltext", {"itemKey": key}, ctx
                )
                fulltext: str = fulltext_result.get("content", "")

                # Index
                title: str = meta.get("title", "")
                authors_list: list[str] = meta.get("creators", [])
                authors_str: str = ", ".join(
                    f"{a.get('firstName', '')} {a.get('lastName', '')}".strip()
                    for a in authors_list
                    if isinstance(a, dict)
                ) if isinstance(authors_list, list) else str(authors_list)
                year: str = str(meta.get("date", meta.get("year", "")))[:4]
                abstract: str = meta.get("abstractNote", "")

                result: dict[str, Any] = await service.index_paper(
                    item_key=key,
                    title=title,
                    authors=authors_str,
                    year=year,
                    abstract=abstract,
                    fulltext=fulltext,
                    version="1" if not force_reindex else "forced",
                )
                results.append({"item_key": key, "title": title, **result})

            except Exception as e:
                logger.warning("Failed to index %s: %s", key, str(e))
                results.append({
                    "item_key": key,
                    "status": "error",
                    "error": str(e),
                })

        indexed_count: int = sum(
            1 for r in results if r.get("status") == "indexed"
        )
        return {
            "indexed": indexed_count,
            "total_requested": len(keys),
            "results": results,
        }

    return index_library_papers
