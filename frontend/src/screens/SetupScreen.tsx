import { useState } from "react";
import { getGeminiKey, getS2Key, setGeminiKey, setS2Key } from "../lib/apiKeys";

interface SetupScreenProps {
  onComplete: () => void;
}

function SetupScreen({ onComplete }: SetupScreenProps): React.ReactElement {
  const [geminiKey, setGeminiKeyState] = useState<string>(getGeminiKey() ?? "");
  const [s2Key, setS2KeyState] = useState<string>(getS2Key() ?? "");
  const [showGeminiKey, setShowGeminiKey] = useState<boolean>(false);
  const [showS2Key, setShowS2Key] = useState<boolean>(false);
  const [geminiError, setGeminiError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const validateGeminiKey = (key: string): string => {
    if (!key.trim()) {
      return "Gemini API key is required.";
    }
    if (!key.startsWith("AI") || key.length <= 20) {
      return "Invalid key format. A Gemini API key starts with \"AI\" and is longer than 20 characters.";
    }
    return "";
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();

    const error: string = validateGeminiKey(geminiKey);
    if (error) {
      setGeminiError(error);
      return;
    }

    setGeminiError("");
    setIsLoading(true);

    // Simulate a brief validation delay; actual API ping will be added later
    setTimeout((): void => {
      setGeminiKey(geminiKey.trim());
      if (s2Key.trim()) {
        setS2Key(s2Key.trim());
      }
      setIsLoading(false);
      onComplete();
    }, 400);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">Colloquia</h1>
          <p className="mt-2 text-sm text-gray-500">
            Voice-powered research assistant
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Gemini API Key */}
          <div>
            <label
              htmlFor="gemini-key"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Gemini API Key <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                id="gemini-key"
                type={showGeminiKey ? "text" : "password"}
                value={geminiKey}
                onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
                  setGeminiKeyState(e.target.value);
                  if (geminiError) setGeminiError("");
                }}
                placeholder="Enter your Gemini API key"
                className={`w-full rounded-lg border px-4 py-2.5 pr-16 text-sm outline-none transition-colors focus:ring-2 ${
                  geminiError
                    ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                    : "border-gray-300 focus:border-blue-500 focus:ring-blue-200"
                }`}
              />
              <button
                type="button"
                onClick={(): void => setShowGeminiKey(!showGeminiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
              >
                {showGeminiKey ? "Hide" : "Show"}
              </button>
            </div>
            {geminiError && (
              <p className="mt-1.5 text-sm text-red-600">{geminiError}</p>
            )}
            <p className="mt-1.5 text-xs text-gray-400">
              Get a key from Google AI Studio
            </p>
          </div>

          {/* Semantic Scholar API Key */}
          <div>
            <label
              htmlFor="s2-key"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Semantic Scholar API Key{" "}
              <span className="text-xs font-normal text-gray-400">
                (optional)
              </span>
            </label>
            <div className="relative">
              <input
                id="s2-key"
                type={showS2Key ? "text" : "password"}
                value={s2Key}
                onChange={(e: React.ChangeEvent<HTMLInputElement>): void =>
                  setS2KeyState(e.target.value)
                }
                placeholder="Optional — for higher rate limits"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 pr-16 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
              <button
                type="button"
                onClick={(): void => setShowS2Key(!showS2Key)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
              >
                {showS2Key ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {/* Privacy Notice */}
          <p className="text-center text-xs text-gray-400">
            Your API key is stored locally in your browser and never sent to our
            servers.
          </p>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="flex w-full items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
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
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                Validating...
              </span>
            ) : (
              "Get Started"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

export default SetupScreen;
