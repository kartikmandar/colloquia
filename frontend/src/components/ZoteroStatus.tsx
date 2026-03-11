import type { ZoteroState } from "../hooks/useZoteroHealth";

interface ZoteroStatusProps {
  state: ZoteroState;
  onRefresh: () => void;
}

function Spinner(): React.ReactElement {
  return (
    <svg
      className="h-4 w-4 animate-spin text-accent-primary"
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
  if (state.loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
        <Spinner />
        <span>Checking Zotero connection...</span>
      </div>
    );
  }

  if (!state.available) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
        <h3 className="mb-2 font-semibold">Zotero Not Detected</h3>
        <p className="mb-3">
          Make sure Zotero 7 is running and API access is enabled.
        </p>
        <ol className="mb-4 list-inside list-decimal space-y-1 text-amber-700 dark:text-amber-400">
          <li>Open Zotero 7</li>
          <li>Go to Edit &gt; Settings &gt; Advanced</li>
          <li>
            Ensure &quot;Allow other applications to communicate with
            Zotero&quot; is checked
          </li>
        </ol>
        <button
          onClick={onRefresh}
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!state.pluginInstalled) {
    return (
      <div className="space-y-2">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
          <h3 className="mb-1 font-semibold">Colloquia Plugin Not Installed</h3>
          <p className="mb-1">
            Install the Colloquia plugin to enable library management features.
          </p>
          <p className="text-blue-600 dark:text-blue-400">
            You can still browse your library without the plugin.
          </p>
        </div>
        {state.libraryEmpty && <LibraryEmptyNote />}
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
