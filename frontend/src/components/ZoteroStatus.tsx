import { useState, useRef, useEffect } from "react";
import type { ZoteroState } from "../hooks/useZoteroHealth";

interface ZoteroStatusProps {
  state: ZoteroState;
  onRefresh: () => void;
}

function Spinner(): React.ReactElement {
  return (
    <svg
      className="h-3 w-3 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
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
  );
}

function ZoteroStatus({
  state,
  onRefresh,
}: ZoteroStatusProps): React.ReactElement {
  const [showDropdown, setShowDropdown] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showDropdown]);

  if (state.loading) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600 dark:bg-blue-950 dark:text-blue-400">
        <Spinner />
        Checking Zotero...
      </div>
    );
  }

  if (!state.available) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
        >
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          Zotero Not Detected
        </button>
        {showDropdown && (
          <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-border-primary bg-surface-primary p-4 text-sm shadow-lg">
            <p className="mb-3 text-text-secondary">
              Make sure Zotero 7 is running with API access enabled.
            </p>
            <ol className="mb-3 list-inside list-decimal space-y-1 text-xs text-text-tertiary">
              <li>Open Zotero 7</li>
              <li>Edit &gt; Settings &gt; Advanced</li>
              <li>Enable &quot;Allow other applications...&quot;</li>
            </ol>
            <button
              onClick={() => {
                onRefresh();
                setShowDropdown(false);
              }}
              className="w-full rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700"
            >
              Retry Connection
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!state.pluginInstalled) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-400 dark:hover:bg-blue-900"
        >
          <span className="h-2 w-2 rounded-full bg-blue-500" />
          Plugin Missing
        </button>
        {showDropdown && (
          <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-border-primary bg-surface-primary p-4 text-sm shadow-lg">
            <p className="mb-1 font-medium text-text-primary">
              Colloquia Plugin Not Installed
            </p>
            <p className="mb-1 text-xs text-text-secondary">
              Install the plugin to enable library management.
            </p>
            <p className="text-xs text-text-tertiary">
              You can still browse your library without it.
            </p>
            {state.libraryEmpty && (
              <div className="mt-3 border-t border-border-primary pt-3">
                <LibraryEmptyNote />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (state.libraryEmpty) {
    return <LibraryEmptyNote />;
  }

  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-400">
      <span className="h-2 w-2 rounded-full bg-green-500" />
      Zotero Connected
    </div>
  );
}

function LibraryEmptyNote(): React.ReactElement {
  return (
    <div className="rounded-lg border border-border-primary bg-surface-secondary p-3 text-sm text-text-secondary">
      <p className="font-medium text-text-primary">
        Your Zotero library is empty
      </p>
      <p>
        Add some papers to get started, or use voice mode to discover papers.
      </p>
    </div>
  );
}

export default ZoteroStatus;
