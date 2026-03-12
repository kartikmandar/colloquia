/**
 * ConnectionBadge — shows WebSocket connection status as a colored dot + label.
 */

import type { ConnectionStatus } from "../hooks/useWebSocket";

interface ConnectionBadgeProps {
  status: ConnectionStatus;
  url?: string;
}

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { color: string; pulse: boolean; label: string }
> = {
  connected: { color: "bg-green-500", pulse: false, label: "Connected" },
  connecting: { color: "bg-yellow-500", pulse: true, label: "Connecting" },
  reconnecting: { color: "bg-yellow-500", pulse: true, label: "Reconnecting" },
  disconnected: { color: "bg-red-500", pulse: false, label: "Disconnected" },
};

function ConnectionBadge({ status, url }: ConnectionBadgeProps): React.ReactElement {
  const config = STATUS_CONFIG[status];
  const isLocal: boolean = url ? url.includes("localhost") : false;
  const locationLabel: string = url ? (isLocal ? "local" : "cloud") : "";

  return (
    <div className="flex items-center gap-1.5" title={url}>
      <span className="relative flex h-2.5 w-2.5">
        {config.pulse && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${config.color}`}
          />
        )}
        <span
          className={`relative inline-flex h-2.5 w-2.5 rounded-full transition-all duration-300 ${config.color}`}
        />
      </span>
      <span className="text-xs text-text-secondary">
        {config.label}
        {locationLabel && status !== "disconnected" && (
          <span className="text-text-tertiary"> ({locationLabel})</span>
        )}
      </span>
    </div>
  );
}

export default ConnectionBadge;
