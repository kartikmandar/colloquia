/**
 * ModelSelector — dropdown for switching AI models with capability badges and categorized sections.
 */

import { useState, useRef, useEffect } from "react";
import type { ModelInfo, ModelListMessage } from "../lib/protocol";

interface ModelSelectorProps {
  modelList: ModelListMessage | null;
  currentMode: "voice" | "text";
  onSwitch: (modelId: string, mode: "voice" | "text") => void;
  isConnected: boolean;
  isSwitching: boolean;
}

/** Short capability pill badges */
function CapabilityBadges({ model }: { model: ModelInfo }): React.ReactElement {
  const caps = model.capabilities;
  const pills: { label: string; active: boolean; color?: string }[] = [
    { label: "Tools", active: caps.supportsTools, color: "green" },
    { label: "Text", active: caps.supportsText },
    { label: "Image", active: caps.supportsImageOutput },
    { label: "Video", active: caps.supportsVideoOutput },
    { label: "Audio", active: caps.supportsAudioOutput },
    { label: "Thinking", active: caps.supportsThinking },
  ];

  const colorClasses: Record<string, string> = {
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    green: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    red: "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300",
  };

  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {pills
        .filter((p) => p.active)
        .map((p) => (
          <span
            key={p.label}
            className={`inline-block rounded-md px-1.5 py-0 text-[10px] font-medium ${
              colorClasses[p.color ?? "blue"]
            }`}
          >
            {p.label}
          </span>
        ))}
      {!caps.supportsTools && caps.supportsText && (
        <span className={`inline-block rounded-md px-1.5 py-0 text-[10px] font-medium ${colorClasses.amber}`}>
          No Tools
        </span>
      )}
      {model.unstable && (
        <span className={`inline-block rounded-md px-1.5 py-0 text-[10px] font-medium ${colorClasses.red}`}>
          Unstable
        </span>
      )}
    </div>
  );
}

interface ModelSectionProps {
  title: string;
  models: ModelInfo[];
  currentModelId: string;
  onSelect: (modelId: string) => void;
}

function ModelSection({ title, models, currentModelId, onSelect }: ModelSectionProps): React.ReactElement | null {
  if (models.length === 0) return null;

  return (
    <>
      <div className="px-2 py-1 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mt-1 first:mt-0">
        {title}
      </div>
      {models.map((model) => (
        <button
          key={model.modelId}
          onClick={() => onSelect(model.modelId)}
          className={`w-full rounded-lg px-2 py-1.5 text-left transition-all hover:bg-surface-tertiary active:scale-[0.98] ${
            model.modelId === currentModelId ? "bg-surface-tertiary" : ""
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-primary">
              {model.displayName}
            </span>
            {model.modelId === currentModelId && (
              <svg
                className="h-3 w-3 text-accent-primary"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>
          <p className="text-[10px] text-text-tertiary mt-0.5">
            {model.capabilities.description}
          </p>
          <CapabilityBadges model={model} />
        </button>
      ))}
    </>
  );
}

function ModelSelector({
  modelList,
  currentMode,
  onSwitch,
  isConnected,
  isSwitching,
}: ModelSelectorProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return (): void =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!modelList) return <></>;

  // Find current model across all categories
  const allNonVoiceModels: ModelInfo[] = [
    ...(modelList.textModels ?? []),
    ...(modelList.imageGenModels ?? []),
    ...(modelList.imagenModels ?? []),
    ...(modelList.ttsModels ?? []),
    ...(modelList.videoGenModels ?? []),
    ...(modelList.openModels ?? []),
    ...(modelList.researchModels ?? []),
  ];

  const currentModelId: string =
    currentMode === "voice"
      ? modelList.currentVoiceModel
      : modelList.currentTextModel;

  const currentModel: ModelInfo | undefined =
    currentMode === "voice"
      ? modelList.voiceModels.find((m) => m.modelId === currentModelId)
      : allNonVoiceModels.find((m) => m.modelId === currentModelId);

  const displayName: string = currentModel?.displayName ?? currentModelId;

  const handleSelect = (modelId: string): void => {
    if (modelId === currentModelId) {
      setIsOpen(false);
      return;
    }
    // All non-voice models use mode "text" for switching
    const mode: "voice" | "text" = currentMode === "voice" ? "voice" : "text";
    onSwitch(modelId, mode);
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={!isConnected || isSwitching}
        className="flex items-center gap-1.5 rounded-lg border border-border-primary px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-all hover:bg-surface-tertiary hover:shadow-sm active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        title={`Current ${currentMode} model: ${currentModelId}`}
      >
        {isSwitching ? (
          <svg
            className="h-3 w-3 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        ) : (
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
          </svg>
        )}
        <span className="max-w-24 truncate">{displayName}</span>
        <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 max-h-96 origin-top-right animate-scale-in overflow-y-auto rounded-xl border border-border-primary bg-surface-primary shadow-elevated">
          <div className="p-1.5">
            {currentMode === "voice" ? (
              <ModelSection
                title="Voice Models"
                models={modelList.voiceModels}
                currentModelId={currentModelId}
                onSelect={handleSelect}
              />
            ) : (
              <>
                <ModelSection
                  title="Text Models (with tools)"
                  models={modelList.textModels ?? []}
                  currentModelId={currentModelId}
                  onSelect={handleSelect}
                />
                <ModelSection
                  title="Image Generation"
                  models={[...(modelList.imageGenModels ?? []), ...(modelList.imagenModels ?? [])]}
                  currentModelId={currentModelId}
                  onSelect={handleSelect}
                />
                <ModelSection
                  title="Video Generation"
                  models={modelList.videoGenModels ?? []}
                  currentModelId={currentModelId}
                  onSelect={handleSelect}
                />
                <ModelSection
                  title="Text-to-Speech"
                  models={modelList.ttsModels ?? []}
                  currentModelId={currentModelId}
                  onSelect={handleSelect}
                />
                <ModelSection
                  title="Open Models (Gemma)"
                  models={modelList.openModels ?? []}
                  currentModelId={currentModelId}
                  onSelect={handleSelect}
                />
                <ModelSection
                  title="Deep Research"
                  models={modelList.researchModels ?? []}
                  currentModelId={currentModelId}
                  onSelect={handleSelect}
                />
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

export default ModelSelector;
