"""Error classification and retry utilities for transient network failures."""

import asyncio
import logging
from typing import Any, Awaitable, Callable, TypeVar

logger: logging.Logger = logging.getLogger(__name__)

T = TypeVar("T")

# Patterns matched against str(exception) for classification
_NETWORK_PATTERNS: list[str] = [
    "SSL",
    "SSLV3_ALERT",
    "ConnectionReset",
    "Connection reset",
    "connection reset",
    "BrokenPipe",
    "Broken pipe",
    "Connection refused",
    "Name or service not known",
    "getaddrinfo failed",
    "Network is unreachable",
    "timed out",
    "ConnectTimeout",
    "ReadTimeout",
]

_SERVICE_PATTERNS: list[str] = [
    "503",
    "500",
    "UNAVAILABLE",
    "INTERNAL",
    "Service Unavailable",
    "Internal Server Error",
    "overloaded",
    "capacity",
]

_RATE_LIMIT_PATTERNS: list[str] = [
    "429",
    "Resource has been exhausted",
    "rate limit",
    "Rate limit",
    "RESOURCE_EXHAUSTED",
    "quota",
]

_AUTH_PATTERNS: list[str] = [
    "401",
    "403",
    "PERMISSION_DENIED",
    "UNAUTHENTICATED",
    "API key",
    "api key",
    "Invalid API key",
    "API_KEY_INVALID",
]


def classify_error(exc: Exception) -> tuple[str, str]:
    """Classify an exception into a category and user-friendly message.

    Returns:
        Tuple of (category, user_message) where category is one of:
        "network", "service", "rate_limit", "auth", "unknown".
    """
    exc_str: str = str(exc)
    exc_type: type = type(exc)

    # Check exception type hierarchy first
    if isinstance(exc, (ConnectionError, ConnectionResetError, BrokenPipeError)):
        return ("network", "Network connection issue — check your internet and try again.")
    if isinstance(exc, OSError) and any(p in exc_str for p in _NETWORK_PATTERNS):
        return ("network", "Network connection issue — check your internet and try again.")
    if isinstance(exc, asyncio.TimeoutError):
        return ("network", "Request timed out — please try again.")

    # Pattern match on exception string
    if any(p in exc_str for p in _AUTH_PATTERNS):
        return ("auth", "API key issue — please check your Gemini API key.")

    if any(p in exc_str for p in _RATE_LIMIT_PATTERNS):
        return ("rate_limit", "Rate limit reached — please wait a moment.")

    if any(p in exc_str for p in _NETWORK_PATTERNS):
        return ("network", "Network connection issue — check your internet and try again.")

    if any(p in exc_str for p in _SERVICE_PATTERNS):
        return ("service", "The AI service is temporarily unavailable. Retrying...")

    return ("unknown", "An unexpected error occurred.")


def is_retryable(category: str) -> bool:
    """Return True if the error category is transient and worth retrying."""
    return category in ("network", "service")


async def retry_async(
    coro_factory: Callable[[], Awaitable[T]],
    max_retries: int = 2,
    base_delay: float = 1.0,
    on_retry: Callable[[int, Exception], Any] | None = None,
) -> T:
    """Retry an async operation on transient failures.

    Args:
        coro_factory: Callable that returns a fresh coroutine each time.
        max_retries: Maximum number of retry attempts.
        base_delay: Base delay in seconds between retries (multiplied by attempt).
        on_retry: Optional callback(attempt, exception) called before each retry.

    Returns:
        The result of the coroutine on success.

    Raises:
        The original exception if retries are exhausted or error is non-retryable.
    """
    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            return await coro_factory()
        except Exception as e:
            last_exc = e
            category, _ = classify_error(e)
            if not is_retryable(category) or attempt >= max_retries:
                raise
            logger.info(
                "Retry %d/%d after %s: %s",
                attempt + 1, max_retries, category, str(e)[:200],
            )
            if on_retry:
                on_retry(attempt + 1, e)
            await asyncio.sleep(base_delay * (attempt + 1))

    # Should never reach here, but satisfy type checker
    assert last_exc is not None
    raise last_exc
