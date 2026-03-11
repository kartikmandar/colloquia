/**
 * ToolCallBadge — collapsible badge showing a tool call's name, status, and result.
 */

import { useState } from "react";

interface ToolCallBadgeProps {
  toolName: string;
  status: "calling" | "done" | "error";
  durationMs?: number;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
}

function getToolIcon(toolName: string): string {
  if (toolName.includes("deep_analysis")) return "\u2699\uFE0F";
  if (toolName.includes("search")) return "\uD83D\uDD0D";
  if (toolName.includes("annotate")) return "\u270F\uFE0F";
  if (toolName.includes("google")) return "\uD83C\uDF10";
  return "\uD83D\uDD27";
}

function getStatusIndicator(status: "calling" | "done" | "error"): string {
  if (status === "calling") return "\u23F3";
  if (status === "done") return "\u2705";
  return "\u274C";
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ToolCallBadge({
  toolName,
  status,
  durationMs,
  input,
  output,
  error,
}: ToolCallBadgeProps): React.ReactElement {
  const [expanded, setExpanded] = useState<boolean>(false);

  const icon: string = getToolIcon(toolName);
  const statusIcon: string = getStatusIndicator(status);
  const duration: string = formatDuration(durationMs);

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={(): void => setExpanded(!expanded)}
        className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors ${
          status === "error"
            ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950 dark:text-red-400 dark:hover:bg-red-900"
            : "bg-surface-tertiary text-text-secondary hover:bg-border-primary"
        }`}
      >
        <span>{icon}</span>
        <span className="font-mono font-medium">{toolName}</span>
        {duration && <span className="text-text-tertiary">{duration}</span>}
        <span>{statusIcon}</span>
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
        <div className="mt-1 rounded-lg border border-border-primary bg-surface-secondary p-2 text-xs">
          {input && Object.keys(input).length > 0 && (
            <div className="mb-1.5">
              <span className="font-semibold text-text-secondary">Input:</span>
              <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-all font-mono text-text-primary">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          {status === "done" && output !== undefined && (
            <div>
              <span className="font-semibold text-text-secondary">Output:</span>
              <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-all font-mono text-text-primary">
                {typeof output === "string"
                  ? output
                  : JSON.stringify(output, null, 2)}
              </pre>
            </div>
          )}
          {status === "error" && error && (
            <div className="text-red-600 dark:text-red-400">
              <span className="font-semibold">Error:</span> {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ToolCallBadge;
