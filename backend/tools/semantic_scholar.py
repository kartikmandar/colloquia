"""Semantic Scholar API client — paper search, DOI lookup, and recommendations.

Provides async functions for discovering academic papers via the
Semantic Scholar Graph API. Used by the Gemini tool system for
paper discovery and recommendation workflows.
"""

import logging
from typing import Any

import httpx

logger: logging.Logger = logging.getLogger(__name__)

BASE_URL: str = "https://api.semanticscholar.org"

# Fields to request for paper search results
SEARCH_FIELDS: str = "title,authors,year,citationCount,doi,abstract,venue,url,externalIds"

# Extended fields for single-paper lookups (includes references/citations)
DETAIL_FIELDS: str = (
    "title,authors,year,citationCount,doi,abstract,venue,url,externalIds,"
    "references,citations,tldr,fieldsOfStudy"
)

# Timeout for API calls (seconds)
TIMEOUT: float = 15.0


def _format_paper(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalise a Semantic Scholar paper object into a clean dict.

    Args:
        raw: Raw paper object from the S2 API.

    Returns:
        Cleaned paper dict with author names extracted.
    """
    authors: list[str] = []
    for a in raw.get("authors") or []:
        name: str | None = a.get("name")
        if name:
            authors.append(name)

    return {
        "paperId": raw.get("paperId"),
        "title": raw.get("title"),
        "authors": authors,
        "year": raw.get("year"),
        "citationCount": raw.get("citationCount"),
        "doi": raw.get("doi"),
        "abstract": raw.get("abstract"),
        "venue": raw.get("venue"),
        "url": raw.get("url"),
        "externalIds": raw.get("externalIds"),
    }


def _build_headers(api_key: str | None = None) -> dict[str, str]:
    """Build HTTP headers, optionally including the S2 API key.

    Args:
        api_key: Optional Semantic Scholar API key for higher rate limits.

    Returns:
        Headers dict.
    """
    headers: dict[str, str] = {"Accept": "application/json"}
    if api_key:
        headers["x-api-key"] = api_key
    return headers


async def search_academic_papers(
    query: str,
    year: str | None = None,
    limit: int = 5,
    api_key: str | None = None,
) -> dict[str, Any]:
    """Search for academic papers by query string.

    Args:
        query: Free-text search query.
        year: Optional year range filter (e.g. "2020-2024" or "2023").
        limit: Maximum number of results (1-100).
        api_key: Optional S2 API key for higher rate limits.

    Returns:
        Dict with "papers" list and "total" count, or "error" on failure.
    """
    params: dict[str, str | int] = {
        "query": query,
        "fields": SEARCH_FIELDS,
        "limit": min(max(limit, 1), 100),
    }
    if year:
        params["year"] = year

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response: httpx.Response = await client.get(
                f"{BASE_URL}/graph/v1/paper/search",
                params=params,
                headers=_build_headers(api_key),
            )

            if response.status_code == 429:
                logger.warning("Semantic Scholar rate limit hit")
                return {"error": "Rate limit exceeded. Try again in a few minutes.", "papers": []}

            response.raise_for_status()
            data: dict[str, Any] = response.json()

            papers: list[dict[str, Any]] = [
                _format_paper(p) for p in (data.get("data") or [])
            ]
            return {"papers": papers, "total": data.get("total", len(papers))}

    except httpx.TimeoutException:
        logger.error("Semantic Scholar search timed out for query: %s", query)
        return {"error": "Search timed out. Try a more specific query.", "papers": []}
    except httpx.HTTPStatusError as e:
        logger.error("Semantic Scholar HTTP error: %s", e.response.status_code)
        return {"error": f"API error ({e.response.status_code})", "papers": []}
    except httpx.HTTPError as e:
        logger.error("Semantic Scholar network error: %s", str(e))
        return {"error": "Network error reaching Semantic Scholar.", "papers": []}


async def get_paper_by_doi(
    doi: str,
    api_key: str | None = None,
) -> dict[str, Any] | None:
    """Fetch a single paper by DOI with references and citations.

    Args:
        doi: The paper's DOI (e.g. "10.1038/s41586-020-2649-2").
        api_key: Optional S2 API key.

    Returns:
        Paper dict with references/citations, or None if not found.
    """
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response: httpx.Response = await client.get(
                f"{BASE_URL}/graph/v1/paper/DOI:{doi}",
                params={"fields": DETAIL_FIELDS},
                headers=_build_headers(api_key),
            )

            if response.status_code == 404:
                return None
            if response.status_code == 429:
                logger.warning("Semantic Scholar rate limit hit for DOI: %s", doi)
                return None

            response.raise_for_status()
            data: dict[str, Any] = response.json()

            result: dict[str, Any] = _format_paper(data)
            # Include references and citations
            result["references"] = [
                _format_paper(r.get("citedPaper", {}))
                for r in (data.get("references") or [])
                if r.get("citedPaper", {}).get("title")
            ]
            result["citations"] = [
                _format_paper(c.get("citingPaper", {}))
                for c in (data.get("citations") or [])
                if c.get("citingPaper", {}).get("title")
            ]
            result["tldr"] = data.get("tldr", {}).get("text") if data.get("tldr") else None
            result["fieldsOfStudy"] = data.get("fieldsOfStudy")
            return result

    except httpx.TimeoutException:
        logger.error("Semantic Scholar DOI lookup timed out: %s", doi)
        return None
    except httpx.HTTPError as e:
        logger.error("Semantic Scholar DOI lookup failed: %s", str(e))
        return None


async def get_paper_recommendations(
    paper_id: str,
    limit: int = 5,
    api_key: str | None = None,
) -> list[dict[str, Any]]:
    """Get paper recommendations based on a seed paper.

    Args:
        paper_id: Semantic Scholar paper ID (or DOI prefixed with "DOI:").
        limit: Maximum number of recommendations.
        api_key: Optional S2 API key.

    Returns:
        List of recommended paper dicts, or empty list on failure.
    """
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response: httpx.Response = await client.post(
                f"{BASE_URL}/recommendations/v1/papers/",
                json={"positivePaperIds": [paper_id]},
                params={"fields": SEARCH_FIELDS, "limit": min(max(limit, 1), 100)},
                headers=_build_headers(api_key),
            )

            if response.status_code == 429:
                logger.warning("Semantic Scholar rate limit hit for recommendations")
                return []

            response.raise_for_status()
            data: dict[str, Any] = response.json()

            return [
                _format_paper(p)
                for p in (data.get("recommendedPapers") or [])
            ]

    except httpx.TimeoutException:
        logger.error("Semantic Scholar recommendations timed out for: %s", paper_id)
        return []
    except httpx.HTTPError as e:
        logger.error("Semantic Scholar recommendations failed: %s", str(e))
        return []
