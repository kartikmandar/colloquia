"""Deep analysis sub-agent — delegates to Gemini Pro for complex reasoning.

Wrapped as an AgentTool so ADK manages the delegation, model call, and
result routing automatically.
"""

from google.adk.agents import LlmAgent
from google.adk.models.google_llm import Gemini
from google.adk.tools import AgentTool

from config import DEEP_ANALYSIS_MODEL

DEEP_ANALYSIS_INSTRUCTION: str = (
    "You are a deep analysis engine for an AI research assistant called Colloquia. "
    "You receive a focused analysis query along with conversation context. "
    "Provide thorough, well-structured analysis with clear reasoning. "
    "Use markdown formatting for clarity. Be precise and cite specific details."
)


def create_deep_analysis_agent(model: Gemini | None = None) -> LlmAgent:
    """Create the deep analysis LlmAgent (gemini-2.5-pro).

    Args:
        model: Pre-configured Gemini model instance (for BYOK).
    """
    return LlmAgent(
        name="deep_analysis",
        model=model if model else DEEP_ANALYSIS_MODEL,
        instruction=DEEP_ANALYSIS_INSTRUCTION,
        description=(
            "Perform deep, thorough analysis of paper content, methodology, or comparisons. "
            "Delegates to a more powerful model for complex reasoning tasks. "
            "Use when the user asks for critique, methodology review, or detailed comparison."
        ),
    )


def create_deep_analysis_tool(model: Gemini | None = None) -> AgentTool:
    """Create the deep analysis AgentTool for use in the main agent."""
    return AgentTool(agent=create_deep_analysis_agent(model=model))
