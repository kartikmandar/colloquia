import { useState, useCallback, useRef, useEffect } from "react";
import { getGeminiKey } from "../lib/apiKeys";
import { useZoteroHealth } from "../hooks/useZoteroHealth";
import { useWebSocket } from "../hooks/useWebSocket";
import { useAudioCapture } from "../hooks/useAudioCapture";
import { AudioStreamer } from "../lib/audio-streamer";
import { resolveBackendUrl } from "../lib/backendUrl";
import { loadPaper } from "../lib/paperLoader";
import type { LoadPaperResult } from "../lib/paperLoader";
import ZoteroStatus from "../components/ZoteroStatus";
import PaperBrowser from "../components/PaperBrowser";
import ConnectionBadge from "../components/ConnectionBadge";
import ChatPanel from "../components/ChatPanel";
import MicButton from "../components/MicButton";

interface MainAppProps {
  onBackToSetup: () => void;
}

function MainApp({ onBackToSetup }: MainAppProps): React.ReactElement {
  const [wsUrl, setWsUrl] = useState<string>("ws://localhost:8000/ws");

  // Resolve best backend URL on mount
  useEffect(() => {
    resolveBackendUrl().then((resolved: string) => {
      setWsUrl(resolved);
    });
  }, []);
  const geminiKey: string | null = getGeminiKey();
  const maskedKey: string = geminiKey
    ? geminiKey.substring(0, 8).replace(/./g, "*")
    : "";
  const { state: zoteroState, refresh: zoteroRefresh } = useZoteroHealth();

  const [selectedPaperKey, setSelectedPaperKey] = useState<string | null>(null);
  const [loadedPaperTitle, setLoadedPaperTitle] = useState<string | null>(null);
  const [paperLoading, setPaperLoading] = useState<boolean>(false);

  // Audio playback context (24kHz for Gemini output)
  const audioStreamerRef = useRef<AudioStreamer | null>(null);

  const getAudioStreamer = useCallback((): AudioStreamer => {
    if (!audioStreamerRef.current) {
      const ctx: AudioContext = new AudioContext({ sampleRate: 24000 });
      audioStreamerRef.current = new AudioStreamer(ctx);
    }
    return audioStreamerRef.current;
  }, []);

  const handleAudioFromServer = useCallback(
    (base64Pcm: string): void => {
      const streamer: AudioStreamer = getAudioStreamer();
      const binaryString: string = atob(base64Pcm);
      const bytes: Uint8Array = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      streamer.addPCM16(bytes);
    },
    [getAudioStreamer]
  );

  // WebSocket connection
  const {
    status,
    messages,
    activeUrl,
    connect,
    disconnect,
    sendAudio,
    sendText,
    sendPaperContext,
  } = useWebSocket({
    url: wsUrl,
    onAudioData: handleAudioFromServer,
  });

  const isConnected: boolean = status === "connected";

  // Audio capture (mic → WebSocket)
  const {
    isCapturing,
    volume,
    startCapture,
    stopCapture,
  } = useAudioCapture({
    onAudioData: sendAudio,
  });

  const handlePaperSelect = useCallback(
    async (paperKey: string): Promise<void> => {
      setSelectedPaperKey(paperKey);

      if (!isConnected) return;

      setPaperLoading(true);
      try {
        const result: LoadPaperResult = await loadPaper(paperKey);
        sendPaperContext(result.message as unknown as Record<string, unknown>);
        setLoadedPaperTitle(result.title);
      } catch (err: unknown) {
        console.error("Failed to load paper:", err);
      } finally {
        setPaperLoading(false);
      }
    },
    [isConnected, sendPaperContext],
  );

  const handleMicToggle = useCallback(async (): Promise<void> => {
    if (isCapturing) {
      stopCapture();
    } else {
      // Resume audio context for playback (requires user gesture)
      const streamer: AudioStreamer = getAudioStreamer();
      await streamer.resume();
      await startCapture();
    }
  }, [isCapturing, startCapture, stopCapture, getAudioStreamer]);

  const handleConnect = useCallback((): void => {
    if (isConnected) {
      // Stop mic if capturing
      if (isCapturing) stopCapture();
      // Stop audio playback
      audioStreamerRef.current?.stop();
      disconnect();
    } else {
      connect();
    }
  }, [isConnected, isCapturing, stopCapture, disconnect, connect]);

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <h1 className="text-lg font-bold text-gray-900">Colloquia</h1>

        <div className="flex items-center gap-3">
          <ConnectionBadge status={status} />
          {status !== "disconnected" && (
            <span className="text-[10px] text-gray-400 max-w-32 truncate" title={activeUrl}>
              {activeUrl.includes("localhost") ? "local" : "cloud"}
            </span>
          )}
          <button
            onClick={handleConnect}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              isConnected
                ? "bg-red-50 text-red-600 hover:bg-red-100"
                : "bg-blue-50 text-blue-600 hover:bg-blue-100"
            }`}
          >
            {isConnected ? "Disconnect" : "Connect"}
          </button>
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

      {/* Main content — split layout */}
      <main className="flex flex-1 overflow-hidden">
        {/* Left: Paper browser */}
        <div className="flex-1 overflow-hidden border-r border-gray-200 p-4">
          <PaperBrowser onPaperSelect={handlePaperSelect} />
        </div>

        {/* Right: Chat + voice panel */}
        <div className="flex w-96 flex-col bg-white">
          {/* Paper loading indicator */}
          {paperLoading && (
            <div className="flex items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-700">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading paper context...
            </div>
          )}
          {loadedPaperTitle && !paperLoading && (
            <div className="flex items-center gap-2 border-b border-purple-100 bg-purple-50 px-4 py-2 text-xs text-purple-700">
              <span className="font-medium truncate" title={loadedPaperTitle}>
                Discussing: {loadedPaperTitle}
              </span>
            </div>
          )}
          {/* Chat messages */}
          <div className="flex-1 overflow-hidden">
            <ChatPanel
              messages={messages}
              onSendText={sendText}
              isConnected={isConnected}
            />
          </div>

          {/* Mic button area */}
          <div className="flex items-center justify-center border-t border-gray-200 py-4">
            <MicButton
              isCapturing={isCapturing}
              isConnected={isConnected}
              volume={volume}
              onToggle={handleMicToggle}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

export default MainApp;
