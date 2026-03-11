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
  // Scale ring size based on volume (0-1 range, capped)
  const ringScale: number = 1 + Math.min(volume * 8, 0.6);

  return (
    <button
      onClick={onToggle}
      disabled={!isConnected}
      aria-label={isCapturing ? "Stop microphone" : "Start microphone"}
      className={`relative flex h-16 w-16 items-center justify-center rounded-full transition-all duration-150 ${
        isCapturing
          ? "bg-red-500 text-white shadow-lg shadow-red-200 hover:bg-red-600 dark:shadow-red-900/30"
          : isConnected
            ? "bg-accent-primary text-white shadow-lg shadow-blue-200 hover:bg-accent-primary-hover dark:shadow-blue-900/30"
            : "bg-surface-tertiary text-text-tertiary cursor-not-allowed"
      }`}
    >
      {/* Volume ring */}
      {isCapturing && (
        <span
          className="absolute inset-0 rounded-full bg-red-400 opacity-30 transition-transform duration-100"
          style={{ transform: `scale(${ringScale})` }}
        />
      )}
      {/* Mic icon */}
      <svg className="relative h-7 w-7" viewBox="0 0 20 20" fill="currentColor">
        {isCapturing ? (
          // Stop icon (square)
          <rect x="6" y="6" width="8" height="8" rx="1" />
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
