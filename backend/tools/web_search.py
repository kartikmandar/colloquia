"""Web search tool — Google Search grounding via a separate Gemini call.

Uses a factory pattern (like zotero_tools) to close over the API key.
The returned function is registered as a custom tool in the text chat loop,
avoiding the API limitation that prevents mixing google_search with custom tools.
"""

import logging
from typing import Any, Callable, Coroutine

logger: logging.Logger = logging.getLogger(__name__)


def create_web_search_tool(
    api_key: str,
) -> Callable[..., Coroutine[Any, Any, dict[str, Any]]]:
    """Return a `search_web` async function that closes over `api_key`."""

    async def search_web(query: str) -> dict[str, Any]:
        """Search the web using Google Search for current information.

        Use for recent news, non-academic queries, or when OpenAlex is insufficient.
        Returns web results with titles, snippets, and source URLs.

        Args:
            query: The search query.
        """
        from google import genai

        client: genai.Client = genai.Client(
            api_key=api_key,
            http_options={"timeout": 30000},
        )

        google_search_tool = genai.types.Tool(
            google_search=genai.types.GoogleSearch()
        )

        try:
            response = await client.aio.models.generate_content(
                model="gemini-2.5-flash",
                contents=query,
                config=genai.types.GenerateContentConfig(
                    tools=[google_search_tool],
                    temperature=0.3,
                    max_output_tokens=1024,
                ),
            )

            answer: str = ""
            sources: list[dict[str, str]] = []
            search_queries: list[str] = []

            # Extract text answer
            if response.candidates and response.candidates[0].content:
                for part in response.candidates[0].content.parts:
                    if part.text:
                        answer += part.text

            # Extract grounding metadata
            if response.candidates:
                candidate = response.candidates[0]
                grounding_meta = getattr(candidate, "grounding_metadata", None)
                if grounding_meta:
                    # Search queries used
                    web_queries = getattr(grounding_meta, "web_search_queries", None)
                    if web_queries:
                        search_queries = list(web_queries)

                    # Source chunks (titles + URLs)
                    grounding_chunks = getattr(grounding_meta, "grounding_chunks", None)
                    if grounding_chunks:
                        for chunk in grounding_chunks:
                            web = getattr(chunk, "web", None)
                            if web:
                                uri = getattr(web, "uri", "")
                                title = getattr(web, "title", "")
                                if uri:
                                    sources.append({"title": title, "url": uri})

            return {
                "answer": answer,
                "sources": sources,
                "search_queries": search_queries,
            }

        except Exception as e:
            logger.error("Web search failed: %s", str(e))
            return {
                "error": f"Web search failed: {str(e)}",
                "answer": "",
                "sources": [],
                "search_queries": [],
            }

    return search_web
