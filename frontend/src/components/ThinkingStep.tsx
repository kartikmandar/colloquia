/**
 * ThinkingStep — collapsible display for Pro model reasoning traces.
 */

import { useState } from "react";

interface ThinkingStepProps {
  content: string;
  durationMs?: number;
}

function ThinkingStep({
  content,
  durationMs,
}: ThinkingStepProps): React.ReactElement {
  const [expanded, setExpanded] = useState<boolean>(false);

  const duration: string =
    durationMs !== undefined
      ? durationMs < 1000
        ? `${durationMs}ms`
        : `${(durationMs / 1000).toFixed(1)}s`
      : "";

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={(): void => setExpanded(!expanded)}
        className="flex items-center gap-1.5 rounded bg-purple-50 px-2 py-1 text-[11px] text-purple-600 transition-colors hover:bg-purple-100"
      >
        <span>{"\uD83D\uDCAD"}</span>
        <span className="font-medium">Thinking...</span>
        {duration && <span className="text-purple-400">{duration}</span>}
        <svg
          className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {expanded && (
        <div className="mt-1 rounded border border-purple-200 bg-purple-50 p-2">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10px] text-purple-800">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

export default ThinkingStep;
