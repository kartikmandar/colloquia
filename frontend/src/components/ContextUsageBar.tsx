/**
 * ContextUsageBar — displays token usage as a progress bar.
 */

interface ContextUsageBarProps {
  totalTokens: number;
  maxTokens: number;
}

function ContextUsageBar({
  totalTokens,
  maxTokens,
}: ContextUsageBarProps): React.ReactElement {
  const percentage: number =
    maxTokens > 0 ? Math.min((totalTokens / maxTokens) * 100, 100) : 0;
  const displayTotal: string =
    totalTokens >= 1000
      ? `${Math.round(totalTokens / 1000)}K`
      : String(totalTokens);
  const displayMax: string =
    maxTokens >= 1000 ? `${Math.round(maxTokens / 1000)}K` : String(maxTokens);

  let colorClass: string;
  if (percentage > 85) {
    colorClass = "bg-red-500";
  } else if (percentage > 65) {
    colorClass = "bg-yellow-500";
  } else {
    colorClass = "bg-green-500";
  }

  return (
    <div
      className="flex items-center gap-1.5"
      title={`${displayTotal} / ${displayMax} tokens`}
    >
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-tertiary">
        <div
          className={`h-full rounded-full transition-all ${colorClass}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs font-mono text-text-tertiary">
        {displayTotal}/{displayMax}
      </span>
    </div>
  );
}

export default ContextUsageBar;
