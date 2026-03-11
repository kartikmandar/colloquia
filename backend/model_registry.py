"""Model registry — metadata and capabilities for all supported Gemini models."""

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelCapabilities:
    """What a model can do."""
    supports_live_api: bool = False      # bidiGenerateContent (voice)
    supports_text: bool = False          # generateContent (text chat)
    supports_image_output: bool = False  # Can generate images
    supports_video_output: bool = False  # Can generate video
    supports_audio_output: bool = False  # Native audio I/O
    supports_thinking: bool = False      # Reasoning traces
    description: str = ""
    category: str = "text"               # "voice" | "text" | "multimodal" | "image_only"


@dataclass(frozen=True)
class ModelEntry:
    """A single model in the registry."""
    model_id: str
    display_name: str
    capabilities: ModelCapabilities
    unstable: bool = False


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

MODEL_REGISTRY: dict[str, ModelEntry] = {
    # --- Core ---
    "gemini-2.5-flash-native-audio-latest": ModelEntry(
        model_id="gemini-2.5-flash-native-audio-latest",
        display_name="Gemini 2.5 Flash Audio",
        capabilities=ModelCapabilities(
            supports_live_api=True,
            supports_audio_output=True,
            description="Primary voice model with native audio I/O",
            category="voice",
        ),
    ),
    "gemini-2.5-flash": ModelEntry(
        model_id="gemini-2.5-flash",
        display_name="Gemini 2.5 Flash",
        capabilities=ModelCapabilities(
            supports_text=True,
            supports_image_output=True,
            description="Reliable text + image generation",
            category="multimodal",
        ),
    ),
    "gemini-2.5-pro": ModelEntry(
        model_id="gemini-2.5-pro",
        display_name="Gemini 2.5 Pro",
        capabilities=ModelCapabilities(
            supports_text=True,
            supports_thinking=True,
            description="Deep analysis with reasoning traces",
            category="text",
        ),
    ),
    "gemini-3.1-flash-lite-preview": ModelEntry(
        model_id="gemini-3.1-flash-lite-preview",
        display_name="Gemini 3.1 Flash Lite",
        capabilities=ModelCapabilities(
            supports_text=True,
            description="Fastest text model (may 503 under load)",
            category="text",
        ),
        unstable=True,
    ),

    # --- Gemini 3 Series ---
    "gemini-3-flash-preview": ModelEntry(
        model_id="gemini-3-flash-preview",
        display_name="Gemini 3 Flash",
        capabilities=ModelCapabilities(
            supports_text=True,
            supports_image_output=True,
            description="Text + image output (unstable — may hang on streaming)",
            category="multimodal",
        ),
        unstable=True,
    ),
    "gemini-3.1-pro": ModelEntry(
        model_id="gemini-3.1-pro",
        display_name="Gemini 3.1 Pro",
        capabilities=ModelCapabilities(
            supports_text=True,
            supports_image_output=True,
            supports_thinking=True,
            description="Advanced text + image with reasoning",
            category="multimodal",
        ),
    ),

    # --- Additional Voice ---
    "gemini-2.5-flash-live-preview": ModelEntry(
        model_id="gemini-2.5-flash-live-preview",
        display_name="Gemini 2.5 Flash Live",
        capabilities=ModelCapabilities(
            supports_live_api=True,
            supports_audio_output=True,
            description="Alternative voice model via Live API",
            category="voice",
        ),
    ),

    # --- Dedicated Image Generation ---
    "imagen-4.0-generate-preview-06-06": ModelEntry(
        model_id="imagen-4.0-generate-preview-06-06",
        display_name="Imagen 4",
        capabilities=ModelCapabilities(
            supports_image_output=True,
            description="Text-to-image only (no chat/tools)",
            category="image_only",
        ),
    ),
    "nano-banana-2": ModelEntry(
        model_id="nano-banana-2",
        display_name="Nano Banana 2",
        capabilities=ModelCapabilities(
            supports_image_output=True,
            description="Fast image generation (no chat/tools)",
            category="image_only",
        ),
    ),
    "nano-banana-pro": ModelEntry(
        model_id="nano-banana-pro",
        display_name="Nano Banana Pro",
        capabilities=ModelCapabilities(
            supports_image_output=True,
            description="High-quality image generation (no chat/tools)",
            category="image_only",
        ),
    ),
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_voice_models() -> list[ModelEntry]:
    """Return models that support the Live API (voice)."""
    return [m for m in MODEL_REGISTRY.values() if m.capabilities.supports_live_api]


def get_text_models() -> list[ModelEntry]:
    """Return models that support generateContent (text chat)."""
    return [m for m in MODEL_REGISTRY.values() if m.capabilities.supports_text]


def _entry_to_dict(entry: ModelEntry) -> dict:
    """Serialize a ModelEntry for JSON transport."""
    return {
        "modelId": entry.model_id,
        "displayName": entry.display_name,
        "unstable": entry.unstable,
        "capabilities": {
            "supportsLiveApi": entry.capabilities.supports_live_api,
            "supportsText": entry.capabilities.supports_text,
            "supportsImageOutput": entry.capabilities.supports_image_output,
            "supportsVideoOutput": entry.capabilities.supports_video_output,
            "supportsAudioOutput": entry.capabilities.supports_audio_output,
            "supportsThinking": entry.capabilities.supports_thinking,
            "description": entry.capabilities.description,
            "category": entry.capabilities.category,
        },
    }


def get_registry_json() -> dict:
    """Return the full registry as a JSON-serializable dict for the frontend."""
    from config import LIVE_MODEL, TEXT_MODEL
    return {
        "voiceModels": [_entry_to_dict(m) for m in get_voice_models()],
        "textModels": [_entry_to_dict(m) for m in get_text_models()],
        "currentVoiceModel": LIVE_MODEL,
        "currentTextModel": TEXT_MODEL,
    }
