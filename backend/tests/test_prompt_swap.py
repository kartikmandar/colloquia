"""Test mid-session system prompt swap via send_client_content(role="system").

Run: conda run -n colloquia python tests/test_prompt_swap.py

Verifies that the Gemini Live API supports updating system instructions
mid-session without resetting the conversation. This de-risks the
lobby → paper transition for Day 3.
"""

import asyncio
import os
import sys

# Add parent dir so we can import prompts
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from google import genai
from google.genai import types
from prompts.lobby import LOBBY_SYSTEM_PROMPT
from prompts.paper import build_paper_prompt


async def test_prompt_swap() -> None:
    """Connect to Gemini Live API, send a message, swap prompt, send another."""
    api_key: str | None = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        # Try loading from .env
        env_path: str = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"
        )
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    if line.startswith("GEMINI_API_KEY="):
                        api_key = line.strip().split("=", 1)[1]
                        break

    if not api_key:
        print("ERROR: Set GEMINI_API_KEY env var or add to backend/.env")
        sys.exit(1)

    client: genai.Client = genai.Client(api_key=api_key)
    model: str = "gemini-2.5-flash-native-audio-latest"

    live_config: types.LiveConnectConfig = types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        system_instruction=LOBBY_SYSTEM_PROMPT,
        output_audio_transcription=types.AudioTranscriptionConfig(),
        input_audio_transcription=types.AudioTranscriptionConfig(),
    )

    print(f"Connecting to {model}...")

    async with client.aio.live.connect(model=model, config=live_config) as session:
        print("Connected with LOBBY prompt.")

        # Step 1: Send a text message in lobby mode
        print("\n--- Step 1: Send text in lobby mode ---")
        await session.send_client_content(
            turns=types.Content(
                role="user",
                parts=[types.Part(text="Hello, what can you help me with?")],
            ),
            turn_complete=True,
        )

        # Collect response
        response_text: str = ""
        async for msg in session.receive():
            if msg.server_content:
                sc = msg.server_content
                if hasattr(sc, "output_transcription") and sc.output_transcription:
                    response_text += sc.output_transcription.text
                    print(f"  Model (lobby): {sc.output_transcription.text}")
                if hasattr(sc, "turn_complete") and sc.turn_complete:
                    break
            if msg.data:
                # Audio data — skip, we just want transcription
                pass

        print(f"\nLobby response received: {len(response_text)} chars")

        # Step 2: Swap to paper mode prompt
        print("\n--- Step 2: Swap to paper mode prompt ---")
        paper_prompt: str = build_paper_prompt(
            title="Test Paper Title",
            authors="Smith et al.",
            year="2025",
            doi="10.1234/test",
            venue="Nature",
            annotation_count=3,
            note_count=1,
            pdf_attachment_key="ABC123",
        )

        await session.send_client_content(
            turns=types.Content(
                role="system",
                parts=[types.Part(text=paper_prompt)],
            ),
            turn_complete=False,
        )
        print("Paper prompt sent via role='system'")

        # Step 3: Ask a paper-specific question
        print("\n--- Step 3: Ask paper question after swap ---")
        await session.send_client_content(
            turns=types.Content(
                role="user",
                parts=[types.Part(
                    text="What paper are we discussing? Tell me the title and authors."
                )],
            ),
            turn_complete=True,
        )

        response_text = ""
        async for msg in session.receive():
            if msg.server_content:
                sc = msg.server_content
                if hasattr(sc, "output_transcription") and sc.output_transcription:
                    response_text += sc.output_transcription.text
                    print(f"  Model (paper): {sc.output_transcription.text}")
                if hasattr(sc, "turn_complete") and sc.turn_complete:
                    break
            if msg.data:
                pass

        print(f"\nPaper response received: {len(response_text)} chars")

        # Verify
        success: bool = "test paper" in response_text.lower() or "smith" in response_text.lower()
        if success:
            print("\nPASS: Mid-session prompt swap works! Model references paper metadata.")
        else:
            print("\nUNCERTAIN: Model response didn't clearly reference the paper.")
            print("   This may need the fallback approach (send as user turn).")
            print(f"   Full response: {response_text}")


if __name__ == "__main__":
    asyncio.run(test_prompt_swap())
