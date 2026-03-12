import { useState } from "react";
import { getGeminiKey, setGeminiKey } from "../lib/apiKeys";

interface SetupScreenProps {
  onComplete: () => void;
}

function SetupScreen({ onComplete }: SetupScreenProps): React.ReactElement {
  const [geminiKey, setGeminiKeyState] = useState<string>(getGeminiKey() ?? "");
  const [showGeminiKey, setShowGeminiKey] = useState<boolean>(false);
  const [geminiError, setGeminiError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const validateGeminiKey = (key: string): string => {
    if (!key.trim()) {
      return "Gemini API key is required.";
    }
    if (!key.startsWith("AI") || key.length <= 20) {
      return 'Invalid key format. A Gemini API key starts with "AI" and is longer than 20 characters.';
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
      setIsLoading(false);
      onComplete();
    }, 400);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface-tertiary p-4">
      {/* Atmospheric background orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-accent-primary/10 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-accent-secondary/10 blur-3xl" />
        <div className="absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 rounded-full bg-accent-primary/5 blur-2xl" />
      </div>

      <div className="relative w-full max-w-md animate-scale-in rounded-2xl bg-surface-primary p-8 shadow-elevated">
        {/* Header */}
        <div className="mb-8 text-center">
          <img src="/logo.svg" alt="Colloquia" className="mx-auto h-12" />
          <p className="mt-3 font-display text-lg italic text-text-secondary">
            Voice-powered research assistant
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Gemini API Key */}
          <div>
            <label
              htmlFor="gemini-key"
              className="mb-1 block text-sm font-medium text-text-primary"
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
                className={`w-full rounded-xl border px-4 py-2.5 pr-16 text-sm text-text-primary bg-surface-primary outline-none transition-all focus:ring-2 focus:shadow-soft ${
                  geminiError
                    ? "border-red-400 focus:border-red-500 focus:ring-red-200 dark:border-red-600 dark:focus:ring-red-900"
                    : "border-border-primary focus:border-accent-primary focus:ring-accent-primary/20"
                }`}
              />
              <button
                type="button"
                onClick={(): void => setShowGeminiKey(!showGeminiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-text-secondary transition-colors hover:text-text-primary"
              >
                {showGeminiKey ? "Hide" : "Show"}
              </button>
            </div>
            {geminiError && (
              <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">
                {geminiError}
              </p>
            )}
            <p className="mt-1.5 text-xs text-text-tertiary">
              Get a key from{" "}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-primary underline transition-colors hover:text-accent-primary-hover"
              >
                Google AI Studio
              </a>
            </p>
          </div>

          {/* Privacy Notice */}
          <p className="text-center text-xs text-text-tertiary">
            Your API key is stored locally in your browser and never sent to our
            servers.
          </p>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#6d4aaa] to-[#a28ae5] px-6 py-3 text-sm font-medium text-white shadow-soft transition-all hover:scale-[1.02] hover:shadow-elevated active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
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
