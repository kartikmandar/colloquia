/**
 * MicButton — large toggle button for voice capture with volume indicator.
 */

interface MicButtonProps {
  isCapturing: boolean;
  isConnected: boolean;
  volume: number;
  onToggle: () => void;
}

function MicButton({
  isCapturing,
  isConnected,
  volume,
  onToggle,
}: MicButtonProps): React.ReactElement {
  // Scale rings based on volume (0-1 range, capped)
  const ringScale1: number = 1 + Math.min(volume * 6, 0.4);
  const ringScale2: number = 1 + Math.min(volume * 10, 0.6);
  const ringScale3: number = 1 + Math.min(volume * 14, 0.8);

  return (
    <button
      onClick={onToggle}
      disabled={!isConnected}
      aria-label={isCapturing ? "Stop microphone" : "Start microphone"}
      className={`relative flex h-20 w-20 items-center justify-center rounded-full transition-all duration-200 ${
        isCapturing
          ? "bg-gradient-to-br from-red-500 to-red-600 text-white shadow-xl shadow-red-300/30 hover:from-red-600 hover:to-red-700 dark:shadow-red-900/30"
          : isConnected
            ? "bg-gradient-to-br from-[#6d4aaa] to-[#a28ae5] text-white shadow-xl shadow-accent-primary/20 hover:from-[#5c3d94] hover:to-[#9478d8] dark:shadow-accent-primary/20"
            : "bg-surface-tertiary text-text-tertiary cursor-not-allowed"
      }`}
    >
      {/* Idle breathing pulse */}
      {!isCapturing && isConnected && (
        <span className="absolute inset-0 rounded-full bg-accent-primary/20 animate-pulse-ring" />
      )}

      {/* Multi-ring volume visualization */}
      {isCapturing && (
        <>
          <span
            className="absolute inset-0 rounded-full bg-red-400/25 transition-transform duration-75"
            style={{ transform: `scale(${ringScale1})` }}
          />
          <span
            className="absolute inset-0 rounded-full bg-red-400/15 transition-transform duration-100"
            style={{ transform: `scale(${ringScale2})` }}
          />
          <span
            className="absolute inset-0 rounded-full bg-red-400/8 transition-transform duration-150"
            style={{ transform: `scale(${ringScale3})` }}
          />
        </>
      )}

      {/* Mic icon */}
      <svg className="relative h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
        {isCapturing ? (
          // Stop icon (square)
          <rect x="6" y="6" width="8" height="8" rx="1.5" />
        ) : (
          // Mic icon
          <path
            fillRule="evenodd"
            d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
            clipRule="evenodd"
          />
        )}
      </svg>
    </button>
  );
}

export default MicButton;
