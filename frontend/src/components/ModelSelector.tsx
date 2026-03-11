/**
 * ModelSelector — dropdown for switching AI models with capability badges.
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
  const pills: { label: string; active: boolean }[] = [
    { label: "Text", active: caps.supportsText },
    { label: "Image", active: caps.supportsImageOutput },
    { label: "Video", active: caps.supportsVideoOutput },
    { label: "Audio", active: caps.supportsAudioOutput },
    { label: "Thinking", active: caps.supportsThinking },
  ];

  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {pills
        .filter((p) => p.active)
        .map((p) => (
          <span
            key={p.label}
            className="inline-block rounded-full bg-blue-100 px-1.5 py-0 text-[10px] font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300"
          >
            {p.label}
          </span>
        ))}
      {model.capabilities.category === "image_only" && (
        <span className="inline-block rounded-full bg-amber-100 px-1.5 py-0 text-[10px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-300">
          Image Only
        </span>
      )}
      {model.unstable && (
        <span className="inline-block rounded-full bg-red-100 px-1.5 py-0 text-[10px] font-medium text-red-600 dark:bg-red-900 dark:text-red-300">
          Unstable
        </span>
      )}
    </div>
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

  const models: ModelInfo[] =
    currentMode === "voice" ? modelList.voiceModels : modelList.textModels;
  const currentModelId: string =
    currentMode === "voice"
      ? modelList.currentVoiceModel
      : modelList.currentTextModel;

  const currentModel: ModelInfo | undefined = models.find(
    (m) => m.modelId === currentModelId,
  );
  const displayName: string = currentModel?.displayName ?? currentModelId;

  const handleSelect = (modelId: string): void => {
    if (modelId === currentModelId) {
      setIsOpen(false);
      return;
    }
    onSwitch(modelId, currentMode);
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={!isConnected || isSwitching}
        className="flex items-center gap-1.5 rounded-lg border border-border-primary px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-tertiary disabled:opacity-50 disabled:cursor-not-allowed"
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
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border-primary bg-surface-primary shadow-lg">
          <div className="p-1.5">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              {currentMode === "voice" ? "Voice Models" : "Text Models"}
            </div>
            {models.map((model) => (
              <button
                key={model.modelId}
                onClick={() => handleSelect(model.modelId)}
                className={`w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-tertiary ${
                  model.modelId === currentModelId
                    ? "bg-surface-tertiary"
                    : ""
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
          </div>
        </div>
      )}

    </div>
  );
}

export default ModelSelector;
