import { useState, useCallback, useRef, useEffect } from "react";
import { Panel, Group } from "react-resizable-panels";
import { getGeminiKey } from "../lib/apiKeys";
import { useZoteroHealth } from "../hooks/useZoteroHealth";
import { useWebSocket } from "../hooks/useWebSocket";
import { useAudioCapture } from "../hooks/useAudioCapture";
import { AudioStreamer } from "../lib/audio-streamer";
import { resolveBackendUrl } from "../lib/backendUrl";
import { loadPaper } from "../lib/paperLoader";
import type { LoadPaperResult } from "../lib/paperLoader";
import { Toaster } from "react-hot-toast";
import ZoteroStatus from "../components/ZoteroStatus";
import PaperBrowser from "../components/PaperBrowser";
import ConnectionBadge from "../components/ConnectionBadge";
import ChatPanel from "../components/ChatPanel";
import MicButton from "../components/MicButton";
import ContextUsageBar from "../components/ContextUsageBar";
import ModelSelector from "../components/ModelSelector";
import ResizeHandle from "../components/ResizeHandle";

interface MainAppProps {
  onBackToSetup: () => void;
  themeState: { theme: "light" | "dark"; toggleTheme: () => void };
}

function MainApp({
  onBackToSetup,
  themeState,
}: MainAppProps): React.ReactElement {
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
  // suppress unused warning — kept for potential future use
  void maskedKey;
  const { state: zoteroState, refresh: zoteroRefresh } = useZoteroHealth();

  const [, setSelectedPaperKey] = useState<string | null>(null);
  const [loadedPaperTitle, setLoadedPaperTitle] = useState<string | null>(null);
  const [paperLoading, setPaperLoading] = useState<boolean>(false);
  const [chatMode, setChatMode] = useState<"voice" | "text">("voice");
  const [sessionEnded, setSessionEnded] = useState<boolean>(false);

  // Audio playback context (24kHz for Gemini output)
  const audioStreamerRef = useRef<AudioStreamer | null>(null);

  const getAudioStreamer = useCallback((): AudioStreamer => {
    if (!audioStreamerRef.current) {
      const ctx: AudioContext = new AudioContext({ sampleRate: 24000 });
      audioStreamerRef.current = new AudioStreamer(ctx);
    }
    return audioStreamerRef.current;
  }, []);

  const handleInterrupted = useCallback((): void => {
    getAudioStreamer().stop();
  }, [getAudioStreamer]);

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
    [getAudioStreamer],
  );

  // WebSocket connection
  const {
    status,
    messages,
    contextUsage,
    activeUrl,
    connect,
    disconnect,
    sendAudio,
    sendText,
    sendPaperContext,
    sendControl,
    modelList,
    isModelSwitching,
    stopTextGeneration,
    isTextGenerating,
    sendModelSwitch,
  } = useWebSocket({
    url: wsUrl,
    onAudioData: handleAudioFromServer,
    onInterrupted: handleInterrupted,
    autoConnect: true,
  });

  const isConnected: boolean = status === "connected";

  // Audio capture (mic → WebSocket)
  const { isCapturing, volume, startCapture, stopCapture } = useAudioCapture({
    onAudioData: sendAudio,
  });

  const handlePaperSelect = useCallback((paperKey: string): void => {
    setSelectedPaperKey(paperKey);
  }, []);

  const handleOpenDiscussion = useCallback(
    async (paperKey: string): Promise<void> => {
      if (!isConnected) return;

      setSelectedPaperKey(paperKey);
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

  const handleBackToLibrary = useCallback((): void => {
    setLoadedPaperTitle(null);
    sendControl("switch_mode", "lobby");
  }, [sendControl]);

  const handleMicToggle = useCallback(async (): Promise<void> => {
    if (isCapturing) {
      stopCapture();
      // Signal Gemini to flush cached audio and process what it has
      sendControl("audio_stream_end");
    } else {
      // Resume audio context for playback (requires user gesture)
      const streamer: AudioStreamer = getAudioStreamer();
      await streamer.resume();
      await startCapture();
    }
  }, [isCapturing, startCapture, stopCapture, getAudioStreamer, sendControl]);

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

  useEffect(() => {
    if (status === "disconnected" && !sessionEnded) {
      // Check if we were previously connected (messages exist)
      if (messages.length > 0) {
        setSessionEnded(true);
      }
    }
    if (status === "connected") {
      setSessionEnded(false);
    }
  }, [status, messages.length, sessionEnded]);

  return (
    <div className="flex h-screen flex-col">
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: "var(--color-surface-primary)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--color-border-primary)",
          },
        }}
      />
      {/* Top bar */}
      <header className="relative z-20 flex items-center justify-between border-b-2 border-border-primary bg-surface-primary/80 px-6 py-2.5 shadow-soft backdrop-blur-sm">
        {/* Left: Logo */}
        <img src="/logo.svg" alt="Colloquia" className="h-8" />

        {/* Right: grouped with dividers */}
        <div className="flex items-center gap-3">
          {/* Group 1: Connection + Context */}
          <ConnectionBadge status={status} url={activeUrl} />
          {contextUsage && (
            <ContextUsageBar
              totalTokens={contextUsage.totalTokens}
              maxTokens={contextUsage.maxTokens}
            />
          )}

          {/* Divider */}
          <div className="h-5 w-px bg-border-primary" />

          {/* Group 2: Model + Actions */}
          <ModelSelector
            modelList={modelList}
            currentMode={chatMode}
            onSwitch={sendModelSwitch}
            isConnected={isConnected}
            isSwitching={isModelSwitching}
          />
          <button
            onClick={handleConnect}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all active:scale-[0.98] ${
              isConnected
                ? "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950 dark:text-red-400 dark:hover:bg-red-900"
                : "bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20"
            }`}
          >
            {isConnected ? "Disconnect" : "Connect"}
          </button>

          {/* Divider */}
          <div className="h-5 w-px bg-border-primary" />

          <ZoteroStatus state={zoteroState} onRefresh={zoteroRefresh} />

          {/* Theme toggle */}
          <button
            onClick={themeState.toggleTheme}
            aria-label="Toggle theme"
            className="rounded-lg p-2 text-text-secondary transition-all hover:bg-surface-tertiary active:scale-[0.98]"
          >
            {themeState.theme === "light" ? (
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </button>
          <button
            onClick={onBackToSetup}
            aria-label="Settings"
            className="rounded-lg border border-border-primary p-2 text-text-secondary transition-all hover:bg-surface-tertiary hover:text-text-primary active:scale-[0.98]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
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

      {/* Main content — resizable split layout */}
      <main className="relative flex-1 overflow-hidden">
        <Group orientation="horizontal">
          <Panel defaultSize="65%" minSize="30%">
            <div className="h-full overflow-hidden p-4">
              <PaperBrowser
                onPaperSelect={handlePaperSelect}
                onOpenDiscussion={handleOpenDiscussion}
              />
            </div>
          </Panel>
          <ResizeHandle />
          <Panel defaultSize="35%" minSize="20%">
            {/* Right: Chat + voice panel */}
            <div className="flex h-full flex-col bg-surface-primary">
              {/* Paper loading indicator */}
              {paperLoading && (
                <div className="flex animate-fade-in-up items-center gap-2 border-b border-accent-primary/20 bg-accent-primary/5 px-4 py-2 text-sm text-accent-primary">
                  <svg
                    className="h-4 w-4 animate-spin"
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
                  Loading paper context...
                </div>
              )}
              {loadedPaperTitle && !paperLoading && (
                <div className="flex animate-fade-in-up items-center justify-between border-b border-purple-100 bg-purple-50 px-4 py-2 text-xs text-purple-700 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-300">
                  <span
                    className="font-medium truncate"
                    title={loadedPaperTitle}
                  >
                    Discussing: {loadedPaperTitle}
                  </span>
                  <button
                    onClick={handleBackToLibrary}
                    className="ml-2 shrink-0 rounded-lg px-2 py-0.5 text-xs font-medium text-purple-600 transition-all hover:bg-purple-200 active:scale-[0.98] dark:text-purple-400 dark:hover:bg-purple-900"
                  >
                    Back to Library
                  </button>
                </div>
              )}
              {/* No-tools warning banner */}
              {(() => {
                if (!modelList || chatMode === "voice") return null;
                const currentTextModelId: string = modelList.currentTextModel;
                const allNonVoice = [
                  ...(modelList.textModels ?? []),
                  ...(modelList.imageGenModels ?? []),
                  ...(modelList.imagenModels ?? []),
                  ...(modelList.ttsModels ?? []),
                  ...(modelList.videoGenModels ?? []),
                  ...(modelList.openModels ?? []),
                  ...(modelList.researchModels ?? []),
                ];
                const currentModel = allNonVoice.find((m) => m.modelId === currentTextModelId);
                if (currentModel && !currentModel.capabilities.supportsTools) {
                  return (
                    <div className="flex animate-fade-in-up items-center gap-2 border-b border-amber-100 bg-amber-50 px-4 py-1.5 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                      <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      Tool integrations (Zotero, OpenAlex) unavailable with this model.
                    </div>
                  );
                }
                return null;
              })()}
              {/* Chat messages */}
              <div className="flex-1 overflow-hidden">
                <ChatPanel
                  messages={messages}
                  onSendText={sendText}
                  onStopGeneration={stopTextGeneration}
                  isConnected={isConnected}
                  isTextGenerating={isTextGenerating}
                  showTextInput={chatMode === "text"}
                />
              </div>

              {/* Input area */}
              <div className="flex items-center gap-2 border-t border-border-primary px-3 py-3">
                <button
                  onClick={() =>
                    setChatMode(chatMode === "voice" ? "text" : "voice")
                  }
                  className="rounded-lg p-2 text-text-secondary transition-all hover:bg-surface-tertiary active:scale-[0.98]"
                  title={
                    chatMode === "voice"
                      ? "Switch to text mode"
                      : "Switch to voice mode"
                  }
                >
                  {chatMode === "voice" ? (
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zm-4 0H9v2h2V9z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </button>
                {chatMode === "voice" ? (
                  <div className="flex flex-1 justify-center">
                    <MicButton
                      isCapturing={isCapturing}
                      isConnected={isConnected && !isModelSwitching}
                      volume={volume}
                      onToggle={handleMicToggle}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </Panel>
        </Group>
        {sessionEnded && (
          <div className="absolute inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/50">
            <div className="animate-scale-in rounded-2xl bg-surface-primary p-6 shadow-elevated text-center max-w-sm">
              <h2 className="font-display text-xl font-semibold text-text-primary mb-2">
                Session Ended
              </h2>
              <p className="text-sm text-text-secondary mb-4">
                The connection was lost. Your chat history is preserved.
              </p>
              <button
                onClick={() => {
                  setSessionEnded(false);
                  connect();
                }}
                className="rounded-lg bg-gradient-to-r from-[#6d4aaa] to-[#a28ae5] px-4 py-2 text-sm font-medium text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                Start New Session
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default MainApp;
