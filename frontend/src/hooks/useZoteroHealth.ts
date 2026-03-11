import { useEffect, useState, useCallback } from "react";

export interface ZoteroState {
  available: boolean;
  pluginInstalled: boolean;
  libraryEmpty: boolean;
  loading: boolean;
  error: string | null;
}

const initialState: ZoteroState = {
  available: false,
  pluginInstalled: false,
  libraryEmpty: false,
  loading: true,
  error: null,
};

interface UseZoteroHealthReturn {
  state: ZoteroState;
  refresh: () => void;
}

export function useZoteroHealth(): UseZoteroHealthReturn {
  const [state, setState] = useState<ZoteroState>(initialState);

  const check = useCallback((): void => {
    setState((prev: ZoteroState) => ({ ...prev, loading: true, error: null }));

    const checkLibrary: Promise<{ available: boolean; libraryEmpty: boolean }> =
      fetch("/zotero-api/users/0/items/top?limit=1")
        .then((res: Response) => {
          if (!res.ok) {
            throw new Error(`Zotero API responded with status ${res.status}`);
          }
          return res.json() as Promise<unknown[]>;
        })
        .then((items: unknown[]) => ({
          available: true,
          libraryEmpty: items.length === 0,
        }))
        .catch(() => ({
          available: false,
          libraryEmpty: false,
        }));

    const checkPlugin: Promise<{ pluginInstalled: boolean }> = fetch(
      "/zotero-plugin/colloquia/ping",
    )
      .then((res: Response) => {
        if (!res.ok) {
          throw new Error(
            `Plugin endpoint responded with status ${res.status}`,
          );
        }
        return { pluginInstalled: true };
      })
      .catch(() => ({
        pluginInstalled: false,
      }));

    Promise.allSettled([checkLibrary, checkPlugin])
      .then(
        (
          results: [
            PromiseSettledResult<{ available: boolean; libraryEmpty: boolean }>,
            PromiseSettledResult<{ pluginInstalled: boolean }>,
          ],
        ) => {
          const libraryResult: { available: boolean; libraryEmpty: boolean } =
            results[0].status === "fulfilled"
              ? results[0].value
              : { available: false, libraryEmpty: false };

          const pluginResult: { pluginInstalled: boolean } =
            results[1].status === "fulfilled"
              ? results[1].value
              : { pluginInstalled: false };

          setState({
            available: libraryResult.available,
            libraryEmpty: libraryResult.libraryEmpty,
            pluginInstalled: pluginResult.pluginInstalled,
            loading: false,
            error: null,
          });
        },
      )
      .catch((err: unknown) => {
        const message: string =
          err instanceof Error ? err.message : "Unknown error checking Zotero";
        setState({
          available: false,
          pluginInstalled: false,
          libraryEmpty: false,
          loading: false,
          error: message,
        });
      });
  }, []);

  useEffect(() => {
    // Wrap in microtask to avoid synchronous setState in effect body
    void Promise.resolve().then(check);
  }, [check]);

  return { state, refresh: check };
}
