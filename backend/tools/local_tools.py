"""Local tools — academic search, recommendations.

These are pure async functions that ADK wraps as FunctionTool automatically.
ADK limitation: no default parameter values. All params required; sentinel
handling inside.
"""

from typing import Any

from tools.openalex import (
    search_academic_papers as _oa_search,
    get_paper_recommendations as _oa_recommend,
)


async def search_academic_papers(query: str, year: str, limit: int) -> dict[str, Any]:
    """Search OpenAlex for academic papers by query.

    Returns titles, authors, years, citation counts, DOIs, and abstracts.
    Use this to help users discover papers not in their Zotero library.

    Args:
        query: Search query (keywords, topic, etc.)
        year: Year range filter e.g. '2020-2024'. Pass empty string to skip.
        limit: Max results to return. Pass 0 for default (5).
    """
    actual_year: str | None = year if year else None
    actual_limit: int = limit if limit > 0 else 5
    return await _oa_search(query=query, year=actual_year, limit=actual_limit)


async def get_paper_recommendations(paper_id: str, limit: int) -> list[dict[str, Any]]:
    """Get paper recommendations based on a seed paper from OpenAlex.

    Provide the OpenAlex work ID to find similar papers.

    Args:
        paper_id: OpenAlex work ID (e.g. 'W1234567890'), or 'DOI:10.xxx/yyy' format.
        limit: Max recommendations to return. Pass 0 for default (5).
    """
    actual_limit: int = limit if limit > 0 else 5
    return await _oa_recommend(paper_id=paper_id, limit=actual_limit)
