/**
 * ToolCallBadge — collapsible badge showing a tool call's name, status, and result.
 * Enhanced rendering for search_web with collapsible citation links.
 */

import { useState } from "react";

interface WebSource {
  title: string;
  url: string;
}

interface WebSearchOutput {
  answer?: string;
  sources?: WebSource[];
  search_queries?: string[];
}

interface ToolCallBadgeProps {
  toolName: string;
  status: "calling" | "done" | "error";
  durationMs?: number;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
}

function getToolIcon(toolName: string): string {
  if (toolName === "search_web") return "[web]";
  if (toolName === "search_academic_papers") return "[scholar]";
  if (toolName.includes("search")) return "[search]";
  if (toolName.includes("annotate")) return "[annotate]";
  return "[tool]";
}

function getToolLabel(toolName: string): string {
  if (toolName === "search_web") return "Web Search";
  if (toolName === "search_academic_papers") return "OpenAlex";
  return toolName;
}

function getStatusIndicator(status: "calling" | "done" | "error"): string {
  if (status === "calling") return "...";
  if (status === "done") return "[ok]";
  return "[err]";
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function isWebSearchOutput(output: unknown): output is WebSearchOutput {
  return (
    typeof output === "object" &&
    output !== null &&
    "sources" in output &&
    Array.isArray((output as WebSearchOutput).sources)
  );
}

function getSourceCount(toolName: string, output: unknown): string {
  if (toolName === "search_web" && isWebSearchOutput(output)) {
    const count: number = output.sources?.length ?? 0;
    if (count > 0) return `${count} source${count !== 1 ? "s" : ""}`;
  }
  return "";
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
  const label: string = getToolLabel(toolName);
  const statusIcon: string = getStatusIndicator(status);
  const duration: string = formatDuration(durationMs);
  const sourceCount: string =
    status === "done" ? getSourceCount(toolName, output) : "";

  const isWebSearch: boolean = toolName === "search_web";
  const webOutput: WebSearchOutput | null =
    isWebSearch && isWebSearchOutput(output) ? output : null;

  return (
    <div className="mt-1 animate-fade-in-up">
      <button
        type="button"
        onClick={(): void => setExpanded(!expanded)}
        className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-all hover:shadow-sm active:scale-[0.98] ${
          status === "error"
            ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950 dark:text-red-400 dark:hover:bg-red-900"
            : "bg-surface-tertiary text-text-secondary hover:bg-border-primary"
        }`}
      >
        <span>{icon}</span>
        <span className="font-mono font-medium">{label}</span>
        {sourceCount && (
          <span className="rounded bg-accent-primary/10 px-1 py-0.5 text-accent-primary">
            {sourceCount}
          </span>
        )}
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
        <div className="mt-1 max-h-64 animate-fade-in-up overflow-y-auto rounded-lg border border-border-primary bg-surface-secondary p-2 text-xs">
          {/* Web search: show citations panel */}
          {isWebSearch && webOutput && (
            <>
              {webOutput.search_queries &&
                webOutput.search_queries.length > 0 && (
                  <div className="mb-1.5">
                    <span className="font-semibold text-text-secondary">
                      Searched:
                    </span>{" "}
                    <span className="text-text-primary">
                      {webOutput.search_queries.join(", ")}
                    </span>
                  </div>
                )}
              {webOutput.sources && webOutput.sources.length > 0 && (
                <div className="mb-1.5">
                  <span className="font-semibold text-text-secondary">
                    Sources:
                  </span>
                  <ul className="mt-1 space-y-1">
                    {webOutput.sources.map(
                      (source: WebSource, idx: number) => (
                        <li key={idx} className="flex items-start gap-1.5">
                          <span className="mt-0.5 shrink-0 text-text-tertiary">
                            {idx + 1}.
                          </span>
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent-primary underline decoration-accent-primary/30 hover:decoration-accent-primary break-all"
                          >
                            {source.title || source.url}
                          </a>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              )}
            </>
          )}

          {/* Generic tool: show input/output as JSON */}
          {!isWebSearch && input && Object.keys(input).length > 0 && (
            <div className="mb-1.5">
              <span className="font-semibold text-text-secondary">Input:</span>
              <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-all font-mono text-text-primary">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          {!isWebSearch && status === "done" && output !== undefined && (
            <div>
              <span className="font-semibold text-text-secondary">
                Output:
              </span>
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
