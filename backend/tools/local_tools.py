"""Local tools — echo, academic search, recommendations.

These are pure async functions that ADK wraps as FunctionTool automatically.
ADK limitation: no default parameter values. All params required; sentinel
handling inside.
"""

from typing import Any

from tools.semantic_scholar import (
    search_academic_papers as _s2_search,
    get_paper_recommendations as _s2_recommend,
)


async def echo(message: str) -> dict[str, str]:
    """Test tool that echoes back a message. Use this to verify tool calling works.

    Args:
        message: The message to echo back.
    """
    return {"echo": message}


async def search_academic_papers(query: str, year: str, limit: int) -> dict[str, Any]:
    """Search Semantic Scholar for academic papers by query.

    Returns titles, authors, years, citation counts, DOIs, and abstracts.
    Use this to help users discover papers not in their Zotero library.

    Args:
        query: Search query (keywords, topic, etc.)
        year: Year range filter e.g. '2020-2024'. Pass empty string to skip.
        limit: Max results to return. Pass 0 for default (5).
    """
    actual_year: str | None = year if year else None
    actual_limit: int = limit if limit > 0 else 5
    return await _s2_search(query=query, year=actual_year, limit=actual_limit)


async def get_paper_recommendations(paper_id: str, limit: int) -> list[dict[str, Any]]:
    """Get paper recommendations based on a seed paper from Semantic Scholar.

    Provide the Semantic Scholar paper ID to find similar papers.

    Args:
        paper_id: Semantic Scholar paper ID (or 'DOI:10.xxx/yyy' format).
        limit: Max recommendations to return. Pass 0 for default (5).
    """
    actual_limit: int = limit if limit > 0 else 5
    return await _s2_recommend(paper_id=paper_id, limit=actual_limit)
