"""Reusable post-processing utilities for compacting Zotero search results.

Reduces token usage by filtering fields, truncating abstracts/creators/tags
based on detail level presets with optional per-parameter overrides.
"""

from typing import Any

DETAIL_PRESETS: dict[str, dict[str, Any]] = {
    "minimal": {
        "fields": ["key", "title", "year", "creators"],
        "maxAuthors": 3,
        "maxAbstractChars": 0,
        "maxTags": 0,
    },
    "standard": {
        "fields": ["key", "title", "creators", "year", "abstractNote", "itemType", "DOI"],
        "maxAuthors": 5,
        "maxAbstractChars": 150,
        "maxTags": 5,
    },
    "full": {
        "fields": [
            "key", "itemType", "title", "creators", "date", "year",
            "DOI", "abstractNote", "publicationTitle", "tags",
        ],
        "maxAuthors": -1,
        "maxAbstractChars": -1,
        "maxTags": -1,
    },
}


def compact_creators(creators: list[dict[str, str]], max_authors: int) -> list[dict[str, str]] | str:
    """Truncate creator list. Returns list or compact string with count."""
    if max_authors == -1 or not creators:
        return creators
    if max_authors == 0:
        return []
    if len(creators) <= max_authors:
        return creators
    truncated: list[dict[str, str]] = creators[:max_authors]
    remaining: int = len(creators) - max_authors
    truncated.append({"name": f"(+{remaining} more)"})
    return truncated


def truncate_abstract(abstract: str, max_chars: int) -> str:
    """Truncate abstract to max_chars on a word boundary. 0 = omit, -1 = unchanged."""
    if max_chars == -1 or not abstract:
        return abstract
    if max_chars == 0:
        return ""
    if len(abstract) <= max_chars:
        return abstract
    # Truncate at word boundary
    truncated: str = abstract[:max_chars]
    last_space: int = truncated.rfind(" ")
    if last_space > max_chars // 2:
        truncated = truncated[:last_space]
    return truncated + "..."


def truncate_tags(tags: list[str], max_tags: int) -> list[str]:
    """Truncate tag list. 0 = omit, -1 = unchanged."""
    if max_tags == -1 or not tags:
        return tags
    if max_tags == 0:
        return []
    if len(tags) <= max_tags:
        return tags
    truncated: list[str] = tags[:max_tags]
    remaining: int = len(tags) - max_tags
    truncated.append(f"(+{remaining} more)")
    return truncated


def strip_empty_values(obj: dict[str, Any]) -> dict[str, Any]:
    """Remove keys with None, empty string, or empty list values."""
    return {k: v for k, v in obj.items() if v is not None and v != "" and v != []}


def compact_search_results(
    raw_result: dict[str, Any],
    detail: str = "minimal",
    maxAuthors: int = 0,
    maxAbstractChars: int = 0,
    maxTags: int = 0,
) -> dict[str, Any]:
    """Compact search results based on detail preset with optional overrides.

    Override params use 0 = "use detail preset default", positive = specific cap, -1 = unlimited.

    Args:
        raw_result: Raw result dict from Zotero plugin (must have "items" key).
        detail: Detail level preset name.
        maxAuthors: Override for max authors per item.
        maxAbstractChars: Override for abstract truncation.
        maxTags: Override for max tags per item.
    """
    if "items" not in raw_result:
        return raw_result

    # Resolve preset (fallback to minimal if invalid)
    preset: dict[str, Any] = DETAIL_PRESETS.get(detail, DETAIL_PRESETS["minimal"])
    allowed_fields: list[str] = preset["fields"]

    # Resolve effective limits: 0 = use preset, non-zero = override
    eff_max_authors: int = maxAuthors if maxAuthors != 0 else preset["maxAuthors"]
    eff_max_abstract: int = maxAbstractChars if maxAbstractChars != 0 else preset["maxAbstractChars"]
    eff_max_tags: int = maxTags if maxTags != 0 else preset["maxTags"]

    # If overrides request fields not in preset, add them
    if maxAbstractChars != 0 and "abstractNote" not in allowed_fields:
        allowed_fields = [*allowed_fields, "abstractNote"]
    if maxTags != 0 and "tags" not in allowed_fields:
        allowed_fields = [*allowed_fields, "tags"]
    if maxAuthors != 0 and "creators" not in allowed_fields:
        allowed_fields = [*allowed_fields, "creators"]

    compacted_items: list[dict[str, Any]] = []
    for item in raw_result["items"]:
        # Filter to allowed fields
        filtered: dict[str, Any] = {k: v for k, v in item.items() if k in allowed_fields}

        # Compact creators
        if "creators" in filtered and isinstance(filtered["creators"], list):
            filtered["creators"] = compact_creators(filtered["creators"], eff_max_authors)

        # Truncate abstract
        if "abstractNote" in filtered and isinstance(filtered["abstractNote"], str):
            filtered["abstractNote"] = truncate_abstract(filtered["abstractNote"], eff_max_abstract)

        # Truncate tags
        if "tags" in filtered and isinstance(filtered["tags"], list):
            filtered["tags"] = truncate_tags(filtered["tags"], eff_max_tags)

        # Strip empties
        filtered = strip_empty_values(filtered)
        compacted_items.append(filtered)

    result: dict[str, Any] = {**raw_result, "items": compacted_items}
    return result
