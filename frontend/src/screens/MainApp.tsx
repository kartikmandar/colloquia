import { useState, useCallback } from "react";
import { getGeminiKey } from "../lib/apiKeys";
import { useZoteroHealth } from "../hooks/useZoteroHealth";
import ZoteroStatus from "../components/ZoteroStatus";
import PaperBrowser from "../components/PaperBrowser";

interface MainAppProps {
  onBackToSetup: () => void;
}

function MainApp({ onBackToSetup }: MainAppProps): React.ReactElement {
  const geminiKey: string | null = getGeminiKey();
  const maskedKey: string = geminiKey
    ? geminiKey.substring(0, 8).replace(/./g, "*")
    : "";
  const { state: zoteroState, refresh: zoteroRefresh } = useZoteroHealth();

  const [selectedPaperKey, setSelectedPaperKey] = useState<string | null>(null);

  const handlePaperSelect = useCallback((paperKey: string): void => {
    setSelectedPaperKey(paperKey);
  }, []);

  // selectedPaperKey will be used later to wire up WebSocket discussion mode
  void selectedPaperKey;

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <h1 className="text-lg font-bold text-gray-900">Colloquia</h1>

        <div className="flex items-center gap-3">
          <ZoteroStatus state={zoteroState} onRefresh={zoteroRefresh} />
          {maskedKey && (
            <span className="text-xs font-mono text-gray-400">
              {maskedKey}
            </span>
          )}
          <button
            onClick={onBackToSetup}
            aria-label="Settings"
            className="rounded-lg border border-gray-200 p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden p-4">
        <PaperBrowser onPaperSelect={handlePaperSelect} />
      </main>
    </div>
  );
}

export default MainApp;
