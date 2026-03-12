"""OpenAlex API client — paper search, DOI lookup, and recommendations.

Provides async functions for discovering academic papers via the
OpenAlex REST API. Used by the Gemini tool system for paper discovery
and recommendation workflows. Free to use — no API key required.
"""

import logging
from typing import Any

import httpx

logger: logging.Logger = logging.getLogger(__name__)

BASE_URL: str = "https://api.openalex.org"

# Timeout for API calls (seconds)
TIMEOUT: float = 15.0

# Default mailto for polite pool (higher rate limits)
DEFAULT_MAILTO: str = "colloquia-app@users.noreply.github.com"


def _reconstruct_abstract(inverted_index: dict[str, list[int]] | None) -> str | None:
    """Reconstruct an abstract from OpenAlex's inverted index format.

    OpenAlex stores abstracts as {"word": [pos1, pos2], ...}. This
    reconstructs the original text by placing words at their positions.

    Args:
        inverted_index: Inverted index mapping words to position lists.

    Returns:
        Reconstructed abstract string, or None if input is None/empty.
    """
    if not inverted_index:
        return None

    words: list[tuple[int, str]] = []
    for word, positions in inverted_index.items():
        for pos in positions:
            words.append((pos, word))

    words.sort(key=lambda x: x[0])
    return " ".join(w for _, w in words)


def _format_work(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalise an OpenAlex work object into a clean dict.

    Maps OpenAlex fields to the same output shape used throughout
    the codebase, maintaining compatibility with existing consumers.

    Args:
        raw: Raw work object from the OpenAlex API.

    Returns:
        Cleaned work dict with consistent field names.
    """
    authors: list[str] = []
    for a in raw.get("authorships") or []:
        author_info: dict[str, Any] = a.get("author") or {}
        name: str | None = author_info.get("display_name")
        if name:
            authors.append(name)

    # Extract DOI without prefix
    raw_doi: str | None = raw.get("doi")
    doi: str | None = None
    if raw_doi:
        doi = raw_doi.replace("https://doi.org/", "")

    # Extract venue from primary location
    venue: str | None = None
    primary_loc: dict[str, Any] | None = raw.get("primary_location")
    if primary_loc:
        source: dict[str, Any] | None = primary_loc.get("source")
        if source:
            venue = source.get("display_name")

    # Extract OpenAlex ID (strip URL prefix)
    openalex_id: str = raw.get("id") or ""
    paper_id: str = openalex_id.split("/")[-1] if openalex_id else ""

    # Open access URL
    oa_url: str | None = None
    oa_info: dict[str, Any] = raw.get("open_access") or {}
    if oa_info:
        oa_url = oa_info.get("oa_url")

    return {
        "paperId": paper_id,
        "title": raw.get("title"),
        "authors": authors,
        "year": raw.get("publication_year"),
        "citationCount": raw.get("cited_by_count"),
        "doi": doi,
        "abstract": _reconstruct_abstract(raw.get("abstract_inverted_index")),
        "venue": venue,
        "url": raw_doi or openalex_id,
        "externalIds": {"DOI": doi, "OpenAlex": paper_id},
        "openAccessUrl": oa_url,
    }


def _base_params(mailto: str) -> dict[str, str]:
    """Build base query parameters for OpenAlex polite pool.

    Args:
        mailto: Email address for polite pool access (higher rate limits).

    Returns:
        Query parameter dict with mailto.
    """
    return {"mailto": mailto}


async def search_academic_papers(
    query: str,
    year: str | None = None,
    limit: int = 5,
    mailto: str | None = None,
) -> dict[str, Any]:
    """Search for academic papers by query string.

    Args:
        query: Free-text search query.
        year: Optional year or year range filter (e.g. "2020-2024" or "2023").
        limit: Maximum number of results (1-100).
        mailto: Email for polite pool (higher rate limits). Uses default if None.

    Returns:
        Dict with "papers" list and "total" count, or "error" on failure.
    """
    effective_mailto: str = mailto or DEFAULT_MAILTO
    params: dict[str, str | int] = {
        **_base_params(effective_mailto),
        "search": query,
        "per_page": min(max(limit, 1), 100),
        "sort": "cited_by_count:desc",
    }

    # Build filter string
    filters: list[str] = []
    if year:
        if "-" in year:
            # Range like "2020-2024"
            parts: list[str] = year.split("-", 1)
            filters.append(f"publication_year:{parts[0]}-{parts[1]}")
        else:
            filters.append(f"publication_year:{year}")

    if filters:
        params["filter"] = ",".join(filters)

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response: httpx.Response = await client.get(
                f"{BASE_URL}/works",
                params=params,
            )

            if response.status_code == 429:
                logger.warning("OpenAlex rate limit hit")
                return {"error": "Rate limit exceeded. Try again in a moment.", "papers": []}

            response.raise_for_status()
            data: dict[str, Any] = response.json()

            papers: list[dict[str, Any]] = [
                _format_work(p) for p in (data.get("results") or [])
            ]
            meta: dict[str, Any] = data.get("meta") or {}
            return {"papers": papers, "total": meta.get("count", len(papers))}

    except httpx.TimeoutException:
        logger.error("OpenAlex search timed out for query: %s", query)
        return {"error": "Search timed out. Try a more specific query.", "papers": []}
    except httpx.HTTPStatusError as e:
        logger.error("OpenAlex HTTP error: %s", e.response.status_code)
        return {"error": f"API error ({e.response.status_code})", "papers": []}
    except httpx.HTTPError as e:
        logger.error("OpenAlex network error: %s", str(e))
        return {"error": "Network error reaching OpenAlex.", "papers": []}


async def get_paper_by_doi(
    doi: str,
    mailto: str | None = None,
) -> dict[str, Any] | None:
    """Fetch a single paper by DOI with references and citations.

    Args:
        doi: The paper's DOI (e.g. "10.1038/s41586-020-2649-2").
        mailto: Email for polite pool. Uses default if None.

    Returns:
        Paper dict with references/citations, or None if not found.
    """
    effective_mailto: str = mailto or DEFAULT_MAILTO

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            # Fetch the work by DOI
            response: httpx.Response = await client.get(
                f"{BASE_URL}/works/https://doi.org/{doi}",
                params=_base_params(effective_mailto),
            )

            if response.status_code == 404:
                return None
            if response.status_code == 429:
                logger.warning("OpenAlex rate limit hit for DOI: %s", doi)
                return None

            response.raise_for_status()
            data: dict[str, Any] = response.json()

            result: dict[str, Any] = _format_work(data)
            work_id: str = data.get("id") or ""

            # Fetch references (referenced_works is a list of OpenAlex IDs)
            ref_ids: list[str] = data.get("referenced_works") or []
            references: list[dict[str, Any]] = []
            if ref_ids:
                # Batch fetch up to 50 referenced works
                ref_filter: str = "|".join(ref_ids[:50])
                ref_resp: httpx.Response = await client.get(
                    f"{BASE_URL}/works",
                    params={
                        **_base_params(effective_mailto),
                        "filter": f"openalex:{ref_filter}",
                        "per_page": 50,
                    },
                )
                if ref_resp.status_code == 200:
                    ref_data: dict[str, Any] = ref_resp.json()
                    references = [
                        _format_work(r) for r in (ref_data.get("results") or [])
                        if r.get("title")
                    ]

            # Fetch citations (works that cite this paper)
            citations: list[dict[str, Any]] = []
            if work_id:
                cite_resp: httpx.Response = await client.get(
                    f"{BASE_URL}/works",
                    params={
                        **_base_params(effective_mailto),
                        "filter": f"cites:{work_id}",
                        "per_page": 50,
                        "sort": "cited_by_count:desc",
                    },
                )
                if cite_resp.status_code == 200:
                    cite_data: dict[str, Any] = cite_resp.json()
                    citations = [
                        _format_work(c) for c in (cite_data.get("results") or [])
                        if c.get("title")
                    ]

            result["references"] = references
            result["citations"] = citations
            # OpenAlex doesn't have TLDR
            result["tldr"] = None
            # Use concepts/topics as fieldsOfStudy
            concepts: list[dict[str, Any]] = data.get("concepts") or []
            result["fieldsOfStudy"] = [
                c["display_name"] for c in concepts
                if c.get("score", 0) > 0.3
            ]
            return result

    except httpx.TimeoutException:
        logger.error("OpenAlex DOI lookup timed out: %s", doi)
        return None
    except httpx.HTTPError as e:
        logger.error("OpenAlex DOI lookup failed: %s", str(e))
        return None


async def get_paper_recommendations(
    paper_id: str,
    limit: int = 5,
    mailto: str | None = None,
) -> list[dict[str, Any]]:
    """Get paper recommendations based on a seed paper.

    Uses OpenAlex's related_works field, with a fallback to
    concept-based search if no related works are available.

    Args:
        paper_id: OpenAlex work ID (e.g. "W1234567890"), DOI prefixed
            with "DOI:" (e.g. "DOI:10.1038/..."), or full OpenAlex URL.
        limit: Maximum number of recommendations.
        mailto: Email for polite pool. Uses default if None.

    Returns:
        List of recommended paper dicts, or empty list on failure.
    """
    effective_mailto: str = mailto or DEFAULT_MAILTO

    # Resolve paper_id to an OpenAlex URL
    if paper_id.startswith("DOI:"):
        lookup_url: str = f"{BASE_URL}/works/https://doi.org/{paper_id[4:]}"
    elif paper_id.startswith("https://"):
        lookup_url = paper_id
    elif paper_id.startswith("W"):
        lookup_url = f"{BASE_URL}/works/{paper_id}"
    else:
        # Try as-is (could be an openalex ID without W prefix)
        lookup_url = f"{BASE_URL}/works/{paper_id}"

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            # Fetch the seed work
            response: httpx.Response = await client.get(
                lookup_url,
                params=_base_params(effective_mailto),
            )

            if response.status_code == 429:
                logger.warning("OpenAlex rate limit hit for recommendations")
                return []
            if response.status_code != 200:
                logger.warning("OpenAlex seed paper fetch failed: %s", response.status_code)
                return []

            seed: dict[str, Any] = response.json()
            related_ids: list[str] = seed.get("related_works") or []

            if related_ids:
                # Batch fetch related works
                fetch_ids: list[str] = related_ids[:limit]
                filter_str: str = "|".join(fetch_ids)
                rel_resp: httpx.Response = await client.get(
                    f"{BASE_URL}/works",
                    params={
                        **_base_params(effective_mailto),
                        "filter": f"openalex:{filter_str}",
                        "per_page": limit,
                    },
                )
                if rel_resp.status_code == 200:
                    rel_data: dict[str, Any] = rel_resp.json()
                    return [
                        _format_work(p) for p in (rel_data.get("results") or [])
                    ]

            # Fallback: use the seed's top concept to find similar papers
            concepts: list[dict[str, Any]] = seed.get("concepts") or []
            if concepts:
                # Sort by score descending, take the top concept
                concepts.sort(key=lambda c: c.get("score", 0), reverse=True)
                top_concept_id: str = concepts[0].get("id", "")
                if top_concept_id:
                    concept_resp: httpx.Response = await client.get(
                        f"{BASE_URL}/works",
                        params={
                            **_base_params(effective_mailto),
                            "filter": f"concepts.id:{top_concept_id}",
                            "per_page": limit,
                            "sort": "cited_by_count:desc",
                        },
                    )
                    if concept_resp.status_code == 200:
                        concept_data: dict[str, Any] = concept_resp.json()
                        return [
                            _format_work(p)
                            for p in (concept_data.get("results") or [])
                        ]

            return []

    except httpx.TimeoutException:
        logger.error("OpenAlex recommendations timed out for: %s", paper_id)
        return []
    except httpx.HTTPError as e:
        logger.error("OpenAlex recommendations failed: %s", str(e))
        return []
