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
    supports_tools: bool = False         # Can use function calling
    description: str = ""
    category: str = "text"               # "voice" | "text" | "multimodal" | "image_gen" | "imagen" | "tts" | "video_gen" | "open" | "research"
    api_pattern: str = "generateContent" # "generateContent" | "bidiGenerateContent" | "predict" | "predictLongRunning" | "tts"


@dataclass(frozen=True)
class ModelEntry:
    """A single model in the registry."""
    model_id: str
    display_name: str
    capabilities: ModelCapabilities
    unstable: bool = False
    deprecated: bool = False


# ---------------------------------------------------------------------------
# Registry — 30 models across 8 categories
# ---------------------------------------------------------------------------

MODEL_REGISTRY: dict[str, ModelEntry] = {
    # -----------------------------------------------------------------------
    # Voice (bidiGenerateContent) — 3 models
    # -----------------------------------------------------------------------
    "gemini-2.5-flash-native-audio-latest": ModelEntry(
        model_id="gemini-2.5-flash-native-audio-latest",
        display_name="Gemini 2.5 Flash Audio",
        capabilities=ModelCapabilities(
            supports_live_api=True,
            supports_audio_output=True,
            supports_tools=True,
            description="Primary voice model with native audio I/O",
            category="voice",
            api_pattern="bidiGenerateContent",
        ),
    ),
    "gemini-2.5-flash-native-audio-preview-12-2025": ModelEntry(
        model_id="gemini-2.5-flash-native-audio-preview-12-2025",
        display_name="Gemini 2.5 Flash Audio (Dec)",
        capabilities=ModelCapabilities(
            supports_live_api=True,
            supports_audio_output=True,
            supports_tools=True,
            description="December 2025 audio preview",
            category="voice",
            api_pattern="bidiGenerateContent",
        ),
    ),
    "gemini-2.5-flash-native-audio-preview-09-2025": ModelEntry(
        model_id="gemini-2.5-flash-native-audio-preview-09-2025",
        display_name="Gemini 2.5 Flash Audio (Sep)",
        capabilities=ModelCapabilities(
            supports_live_api=True,
            supports_audio_output=True,
            supports_tools=True,
            description="September 2025 audio preview",
            category="voice",
            api_pattern="bidiGenerateContent",
        ),
    ),

    # -----------------------------------------------------------------------
    # Text/Multimodal (generateContent + tools) — 7 models
    # -----------------------------------------------------------------------
    "gemini-3.1-pro-preview": ModelEntry(
        model_id="gemini-3.1-pro-preview",
        display_name="Gemini 3.1 Pro",
        capabilities=ModelCapabilities(
            supports_text=True,
            supports_image_output=True,
            supports_thinking=True,
            supports_tools=True,
            description="Advanced text + image with reasoning",
            category="multimodal",
        ),
    ),
    "gemini-3.1-pro-preview-customtools": ModelEntry(
        model_id="gemini-3.1-pro-preview-customtools",
        display_name="Gemini 3.1 Pro (Custom Tools)",
        capabilities=ModelCapabilities(
            supports_text=True,
            supports_image_output=True,
            supports_thinking=True,
            supports_tools=True,
            description="Optimized for custom tool usage",
            category="multimodal",
        ),
    ),
    "gemini-3.1-flash-lite-preview": ModelEntry(
        model_id="gemini-3.1-flash-lite-preview",
        display_name="Gemini 3.1 Flash Lite",
        capabilities=ModelCapabilities(
            supports_text=True,
            supports_tools=True,
            description="Fastest text model (may 503 under load)",
            category="text",
        ),
        unstable=True,
    ),
    "gemini-3-flash-preview": ModelEntry(
        model_id="gemini-3-flash-preview",
        display_name="Gemini 3 Flash",
        capabilities=ModelCapabilities(
            supports_text=True,
            supports_image_output=True,
            supports_tools=True,
            description="Text + image output (unstable — may hang on streaming)",
            category="multimodal",
        ),
        unstable=True,
    ),
    "gemini-2.5-pro": ModelEntry(
        model_id="gemini-2.5-pro",
        display_name="Gemini 2.5 Pro",
        capabilities=ModelCapabilities(
            supports_text=True,
            supports_thinking=True,
            supports_tools=True,
            description="Deep analysis with reasoning traces",
            category="text",
        ),
    ),
    "gemini-2.5-flash": ModelEntry(
        model_id="gemini-2.5-flash",
        display_name="Gemini 2.5 Flash",
        capabilities=ModelCapabilities(
            supports_text=True,
            supports_image_output=True,
            supports_tools=True,
            description="Reliable text + image generation",
            category="multimodal",
        ),
    ),
    "gemini-2.5-flash-lite": ModelEntry(
        model_id="gemini-2.5-flash-lite",
        display_name="Gemini 2.5 Flash Lite",
        capabilities=ModelCapabilities(
            supports_text=True,
            supports_tools=True,
            description="Lightweight and fast text model",
            category="text",
        ),
    ),

    # -----------------------------------------------------------------------
    # Image Generation (generateContent, no tools) — 3 models
    # -----------------------------------------------------------------------
    "gemini-2.5-flash-image": ModelEntry(
        model_id="gemini-2.5-flash-image",
        display_name="Nano Banana",
        capabilities=ModelCapabilities(
            supports_text=True,
            supports_image_output=True,
            description="Fast image generation via Gemini",
            category="image_gen",
        ),
    ),
    "gemini-3-pro-image-preview": ModelEntry(
        model_id="gemini-3-pro-image-preview",
        display_name="Nano Banana Pro",
        capabilities=ModelCapabilities(
            supports_text=True,
            supports_image_output=True,
            description="High-quality image generation",
            category="image_gen",
        ),
    ),
    "gemini-3.1-flash-image-preview": ModelEntry(
        model_id="gemini-3.1-flash-image-preview",
        display_name="Nano Banana 2",
        capabilities=ModelCapabilities(
            supports_text=True,
            supports_image_output=True,
            description="Latest fast image generation",
            category="image_gen",
        ),
    ),

    # -----------------------------------------------------------------------
    # Imagen (predict API, no tools) — 3 models
    # -----------------------------------------------------------------------
    "imagen-4.0-generate-001": ModelEntry(
        model_id="imagen-4.0-generate-001",
        display_name="Imagen 4",
        capabilities=ModelCapabilities(
            supports_image_output=True,
            description="Text-to-image generation (Imagen)",
            category="imagen",
            api_pattern="predict",
        ),
    ),
    "imagen-4.0-fast-generate-001": ModelEntry(
        model_id="imagen-4.0-fast-generate-001",
        display_name="Imagen 4 Fast",
        capabilities=ModelCapabilities(
            supports_image_output=True,
            description="Fast text-to-image generation",
            category="imagen",
            api_pattern="predict",
        ),
    ),
    "imagen-4.0-ultra-generate-001": ModelEntry(
        model_id="imagen-4.0-ultra-generate-001",
        display_name="Imagen 4 Ultra",
        capabilities=ModelCapabilities(
            supports_image_output=True,
            description="Highest quality text-to-image",
            category="imagen",
            api_pattern="predict",
        ),
    ),

    # -----------------------------------------------------------------------
    # TTS (generateContent with audio output, no tools) — 2 models
    # -----------------------------------------------------------------------
    "gemini-2.5-flash-preview-tts": ModelEntry(
        model_id="gemini-2.5-flash-preview-tts",
        display_name="Gemini 2.5 Flash TTS",
        capabilities=ModelCapabilities(
            supports_audio_output=True,
            description="Text-to-speech synthesis",
            category="tts",
            api_pattern="tts",
        ),
    ),
    "gemini-2.5-pro-preview-tts": ModelEntry(
        model_id="gemini-2.5-pro-preview-tts",
        display_name="Gemini 2.5 Pro TTS",
        capabilities=ModelCapabilities(
            supports_audio_output=True,
            description="High-quality text-to-speech",
            category="tts",
            api_pattern="tts",
        ),
    ),

    # -----------------------------------------------------------------------
    # Video Generation (predictLongRunning, no tools) — 5 models
    # -----------------------------------------------------------------------
    "veo-3.1-generate-preview": ModelEntry(
        model_id="veo-3.1-generate-preview",
        display_name="Veo 3.1",
        capabilities=ModelCapabilities(
            supports_video_output=True,
            description="Latest video generation model",
            category="video_gen",
            api_pattern="predictLongRunning",
        ),
    ),
    "veo-3.1-fast-generate-preview": ModelEntry(
        model_id="veo-3.1-fast-generate-preview",
        display_name="Veo 3.1 Fast",
        capabilities=ModelCapabilities(
            supports_video_output=True,
            description="Fast video generation",
            category="video_gen",
            api_pattern="predictLongRunning",
        ),
    ),
    "veo-3.0-generate-001": ModelEntry(
        model_id="veo-3.0-generate-001",
        display_name="Veo 3",
        capabilities=ModelCapabilities(
            supports_video_output=True,
            description="High-quality video generation",
            category="video_gen",
            api_pattern="predictLongRunning",
        ),
    ),
    "veo-3.0-fast-generate-001": ModelEntry(
        model_id="veo-3.0-fast-generate-001",
        display_name="Veo 3 Fast",
        capabilities=ModelCapabilities(
            supports_video_output=True,
            description="Fast video generation",
            category="video_gen",
            api_pattern="predictLongRunning",
        ),
    ),
    "veo-2.0-generate-001": ModelEntry(
        model_id="veo-2.0-generate-001",
        display_name="Veo 2",
        capabilities=ModelCapabilities(
            supports_video_output=True,
            description="Stable video generation",
            category="video_gen",
            api_pattern="predictLongRunning",
        ),
    ),

    # -----------------------------------------------------------------------
    # Open Models (generateContent, no tools) — 6 models
    # -----------------------------------------------------------------------
    "gemma-3-27b-it": ModelEntry(
        model_id="gemma-3-27b-it",
        display_name="Gemma 3 27B",
        capabilities=ModelCapabilities(
            supports_text=True,
            description="Open model — 27B parameters",
            category="open",
        ),
    ),
    "gemma-3-12b-it": ModelEntry(
        model_id="gemma-3-12b-it",
        display_name="Gemma 3 12B",
        capabilities=ModelCapabilities(
            supports_text=True,
            description="Open model — 12B parameters",
            category="open",
        ),
    ),
    "gemma-3-4b-it": ModelEntry(
        model_id="gemma-3-4b-it",
        display_name="Gemma 3 4B",
        capabilities=ModelCapabilities(
            supports_text=True,
            description="Open model — 4B parameters",
            category="open",
        ),
    ),
    "gemma-3-1b-it": ModelEntry(
        model_id="gemma-3-1b-it",
        display_name="Gemma 3 1B",
        capabilities=ModelCapabilities(
            supports_text=True,
            description="Open model — 1B parameters",
            category="open",
        ),
    ),
    "gemma-3n-e4b-it": ModelEntry(
        model_id="gemma-3n-e4b-it",
        display_name="Gemma 3n E4B",
        capabilities=ModelCapabilities(
            supports_text=True,
            description="Efficient open model — E4B",
            category="open",
        ),
    ),
    "gemma-3n-e2b-it": ModelEntry(
        model_id="gemma-3n-e2b-it",
        display_name="Gemma 3n E2B",
        capabilities=ModelCapabilities(
            supports_text=True,
            description="Efficient open model — E2B",
            category="open",
        ),
    ),

    # -----------------------------------------------------------------------
    # Research (generateContent, no tools) — 1 model
    # -----------------------------------------------------------------------
    "deep-research-pro-preview-12-2025": ModelEntry(
        model_id="deep-research-pro-preview-12-2025",
        display_name="Deep Research Pro",
        capabilities=ModelCapabilities(
            supports_text=True,
            supports_thinking=True,
            description="Deep research and analysis",
            category="research",
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
    """Return models that support generateContent with tools (text chat)."""
    return [m for m in MODEL_REGISTRY.values()
            if m.capabilities.supports_text and m.capabilities.supports_tools]


def get_image_gen_models() -> list[ModelEntry]:
    """Return image generation models (Gemini-based, no tools)."""
    return [m for m in MODEL_REGISTRY.values() if m.capabilities.category == "image_gen"]


def get_imagen_models() -> list[ModelEntry]:
    """Return Imagen models (predict API)."""
    return [m for m in MODEL_REGISTRY.values() if m.capabilities.category == "imagen"]


def get_tts_models() -> list[ModelEntry]:
    """Return TTS models."""
    return [m for m in MODEL_REGISTRY.values() if m.capabilities.category == "tts"]


def get_video_gen_models() -> list[ModelEntry]:
    """Return video generation models."""
    return [m for m in MODEL_REGISTRY.values() if m.capabilities.category == "video_gen"]


def get_open_models() -> list[ModelEntry]:
    """Return open-weight models (Gemma)."""
    return [m for m in MODEL_REGISTRY.values() if m.capabilities.category == "open"]


def get_research_models() -> list[ModelEntry]:
    """Return research models."""
    return [m for m in MODEL_REGISTRY.values() if m.capabilities.category == "research"]


def _entry_to_dict(entry: ModelEntry) -> dict:
    """Serialize a ModelEntry for JSON transport."""
    return {
        "modelId": entry.model_id,
        "displayName": entry.display_name,
        "unstable": entry.unstable,
        "deprecated": entry.deprecated,
        "capabilities": {
            "supportsLiveApi": entry.capabilities.supports_live_api,
            "supportsText": entry.capabilities.supports_text,
            "supportsImageOutput": entry.capabilities.supports_image_output,
            "supportsVideoOutput": entry.capabilities.supports_video_output,
            "supportsAudioOutput": entry.capabilities.supports_audio_output,
            "supportsThinking": entry.capabilities.supports_thinking,
            "supportsTools": entry.capabilities.supports_tools,
            "description": entry.capabilities.description,
            "category": entry.capabilities.category,
            "apiPattern": entry.capabilities.api_pattern,
        },
    }


def get_registry_json() -> dict:
    """Return the full registry as a JSON-serializable dict for the frontend."""
    from config import LIVE_MODEL, TEXT_MODEL
    return {
        "voiceModels": [_entry_to_dict(m) for m in get_voice_models()],
        "textModels": [_entry_to_dict(m) for m in get_text_models()],
        "imageGenModels": [_entry_to_dict(m) for m in get_image_gen_models()],
        "imagenModels": [_entry_to_dict(m) for m in get_imagen_models()],
        "ttsModels": [_entry_to_dict(m) for m in get_tts_models()],
        "videoGenModels": [_entry_to_dict(m) for m in get_video_gen_models()],
        "openModels": [_entry_to_dict(m) for m in get_open_models()],
        "researchModels": [_entry_to_dict(m) for m in get_research_models()],
        "currentVoiceModel": LIVE_MODEL,
        "currentTextModel": TEXT_MODEL,
    }
