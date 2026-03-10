"""Zotero library search tool — delegated to frontend via WebSocket.

Since the Zotero local API runs on the user's machine (localhost:23119),
the backend cannot access it directly. Instead, this tool delegates
the search to the frontend's Zotero plugin endpoint.
"""

import logging
from typing import Any

logger: logging.Logger = logging.getLogger(__name__)


async def search_zotero_library(
    query: str = "",
    tag: str = "",
    collection: str = "",
    author: str = "",
) -> dict[str, Any]:
    """Search the user's Zotero library.

    This is a Zotero write tool that gets delegated to the frontend,
    which calls the Colloquia plugin's /colloquia/searchLibrary endpoint.

    Args:
        query: Search text (matches title, creator, year)
        tag: Filter by tag name
        collection: Filter by collection key
        author: Filter by author name

    Returns:
        dict with 'items' list of matching papers
    """
    # Build params — only include non-empty values
    params: dict[str, Any] = {}
    if query:
        params["query"] = query
    if tag:
        params["tag"] = tag
    if collection:
        params["collection"] = collection
    if author:
        params["author"] = author

    # This function is never called directly — it's delegated to frontend
    # via delegate_to_frontend() in session_handler.py.
    # The return value here is just for type documentation.
    return params
