"""Deep analysis tool — delegates to Gemini Pro for complex reasoning.

Uses gemini-3.1-pro-preview via the standard generateContent API
for thorough, non-real-time analysis of paper content, methodology,
or comparisons.
"""

import logging
from typing import Any

from google import genai
from google.genai import types

logger: logging.Logger = logging.getLogger(__name__)

DEEP_ANALYSIS_MODEL: str = "gemini-2.5-pro"

DEEP_ANALYSIS_SYSTEM_PROMPT: str = (
    "You are a deep analysis engine for an AI research assistant called Colloquia. "
    "You receive a focused analysis query along with conversation context. "
    "Provide thorough, well-structured analysis with clear reasoning. "
    "Use markdown formatting for clarity. Be precise and cite specific details."
)


async def deep_analysis(
    query: str,
    context: str,
    api_key: str,
) -> dict[str, Any]:
    """Run a deep analysis query via Gemini Pro.

    Args:
        query: The specific analysis question or task.
        context: Conversation context (paper content, prior discussion).
        api_key: Gemini API key.

    Returns:
        Dict with "analysis" text or "error" message.
    """
    try:
        client: genai.Client = genai.Client(api_key=api_key)

        contents: list[dict[str, Any]] = []
        if context:
            contents.append({
                "role": "user",
                "parts": [{"text": f"[Context]\n{context}"}],
            })
            contents.append({
                "role": "model",
                "parts": [{"text": "I have the context. What would you like me to analyze?"}],
            })

        contents.append({
            "role": "user",
            "parts": [{"text": query}],
        })

        response = await client.aio.models.generate_content(
            model=DEEP_ANALYSIS_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=DEEP_ANALYSIS_SYSTEM_PROMPT,
                temperature=0.7,
                max_output_tokens=4096,
            ),
        )

        analysis_text: str = response.text or "No analysis generated."
        return {"analysis": analysis_text}

    except Exception as e:
        logger.error("Deep analysis failed: %s", str(e))
        return {"error": f"Deep analysis failed: {str(e)}"}
