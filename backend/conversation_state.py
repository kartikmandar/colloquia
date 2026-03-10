"""Shared conversation state for voice and text chat modes.

Tracks chronological events (messages, tool calls, mode changes) so that
text-mode generateContent calls can include conversation history from the
voice session and vice versa.
"""

import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ConversationEvent:
    """A single event in the conversation timeline."""

    timestamp: float
    event_type: str  # "message" | "tool_call" | "tool_result" | "mode_change"
    role: str  # "user" | "assistant" | "system"
    content: str
    metadata: dict[str, Any] | None = None


@dataclass
class ConversationState:
    """Tracks the full conversation across voice and text modes."""

    timeline: list[ConversationEvent] = field(default_factory=list)
    paper_context: dict[str, Any] | None = None
    session_mode: str = "lobby"  # "lobby" | "paper"

    def add_message(self, role: str, text: str) -> None:
        """Append a user or assistant message event."""
        self.timeline.append(
            ConversationEvent(
                timestamp=time.time(),
                event_type="message",
                role=role,
                content=text,
            )
        )

    def add_tool_call(self, tool_name: str, args: dict[str, Any]) -> None:
        """Append a tool invocation event."""
        self.timeline.append(
            ConversationEvent(
                timestamp=time.time(),
                event_type="tool_call",
                role="assistant",
                content=f"Called {tool_name}",
                metadata={"tool_name": tool_name, "args": args},
            )
        )

    def add_tool_result(
        self, tool_name: str, output: str, success: bool = True
    ) -> None:
        """Append a tool result event."""
        self.timeline.append(
            ConversationEvent(
                timestamp=time.time(),
                event_type="tool_result",
                role="system",
                content=output,
                metadata={
                    "tool_name": tool_name,
                    "success": success,
                },
            )
        )

    def set_mode(
        self, mode: str, paper_context: dict[str, Any] | None = None
    ) -> None:
        """Update session mode, optionally setting paper context."""
        self.session_mode = mode
        if paper_context is not None:
            self.paper_context = paper_context
        self.timeline.append(
            ConversationEvent(
                timestamp=time.time(),
                event_type="mode_change",
                role="system",
                content=f"Mode changed to {mode}",
                metadata={"mode": mode},
            )
        )

    def to_text_context(self, token_budget: int = 30000) -> list[dict[str, Any]]:
        """Build a content array for the generateContent API.

        Returns a list of alternating user/model turns suitable for
        ``google.genai.types.Content``. Walks the timeline in reverse to
        prioritise recent events, and trims the oldest entries when the
        approximate token budget is exceeded.

        Token estimation: ``len(text) / 4`` (rough char-to-token ratio).
        """
        # Collect raw entries (newest first)
        raw: list[tuple[str, str]] = []
        tokens_used: int = 0

        # Prepend paper context summary if in paper mode
        if self.session_mode == "paper" and self.paper_context:
            ctx = self.paper_context
            summary = (
                f"[Paper context] Title: {ctx.get('title', 'Unknown')}. "
                f"Authors: {ctx.get('authors', 'Unknown')}. "
                f"Year: {ctx.get('year', '')}. "
                f"DOI: {ctx.get('doi', '')}."
            )
            summary_tokens = len(summary) // 4
            tokens_used += summary_tokens
            raw.append(("user", summary))

        # Walk timeline in reverse, collecting events
        for event in reversed(self.timeline):
            if event.event_type == "mode_change":
                continue

            text = event.content
            est_tokens = len(text) // 4
            if tokens_used + est_tokens > token_budget:
                break
            tokens_used += est_tokens

            # Map roles: user → user, assistant → model, system → user
            if event.role == "assistant":
                gemini_role = "model"
            else:
                gemini_role = "user"

            # Format tool events with context
            if event.event_type == "tool_call" and event.metadata:
                tool_name: str = event.metadata.get("tool_name", "unknown")
                args: dict[str, Any] = event.metadata.get("args", {})
                text = f"[Tool call: {tool_name}] Args: {args}"
            elif event.event_type == "tool_result" and event.metadata:
                tool_name = event.metadata.get("tool_name", "unknown")
                success: bool = event.metadata.get("success", True)
                status = "success" if success else "error"
                text = f"[Tool result: {tool_name} ({status})] {text}"

            raw.append((gemini_role, text))

        # Reverse to chronological order
        raw.reverse()

        # Merge consecutive same-role entries for valid alternating turns
        merged: list[dict[str, Any]] = []
        for role, text in raw:
            if merged and merged[-1]["role"] == role:
                # Append to existing turn
                merged[-1]["parts"][0]["text"] += f"\n{text}"
            else:
                merged.append({"role": role, "parts": [{"text": text}]})

        # Ensure conversation starts with "user" (Gemini requirement)
        if merged and merged[0]["role"] == "model":
            merged.insert(0, {"role": "user", "parts": [{"text": "[conversation start]"}]})

        return merged
