/**
 * Backend URL resolution with automatic failover.
 *
 * Priority:
 * 1. VITE_WS_URL env variable (explicit override)
 * 2. Try local backend (ws://localhost:8000) — preferred for dev (low latency)
 * 3. Fall back to Cloud Run deployment
 */

const CLOUD_RUN_URL: string =
  "wss://colloquia-backend-318881942640.us-central1.run.app/ws";
const LOCAL_URL: string = "ws://localhost:8000/ws";
const LOCAL_HEALTH_URL: string = "http://localhost:8000/health";

/**
 * Resolve the best available backend WebSocket URL.
 * Checks if the local backend is running first; if not, uses Cloud Run.
 */
export async function resolveBackendUrl(): Promise<string> {
  // Explicit override always wins
  const envUrl: string | undefined = import.meta.env.VITE_WS_URL as
    | string
    | undefined;
  if (envUrl) {
    return envUrl;
  }

  // Probe local backend health endpoint
  try {
    const resp: Response = await fetch(LOCAL_HEALTH_URL, {
      signal: AbortSignal.timeout(1500),
    });
    if (resp.ok) {
      return LOCAL_URL;
    }
  } catch {
    // Local backend not available
  }

  return CLOUD_RUN_URL;
}

/**
 * Get the fallback URL (the other one).
 */
export function getFallbackUrl(currentUrl: string): string {
  if (currentUrl === LOCAL_URL) {
    return CLOUD_RUN_URL;
  }
  return LOCAL_URL;
}

export { CLOUD_RUN_URL, LOCAL_URL };
