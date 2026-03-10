import { registerEndpoints, unregisterEndpoints } from "./modules/endpoints";
import { createZToolkit } from "./utils/ztoolkit";

async function onStartup(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  // Register all HTTP endpoints for Colloquia
  registerEndpoints();

  // Mark initialized
  addon.data.initialized = true;

  ztoolkit.log("Colloquia plugin started — endpoints registered");
}

async function onMainWindowLoad(
  win: _ZoteroTypes.MainWindow,
): Promise<void> {
  addon.data.ztoolkit = createZToolkit();
  ztoolkit.log("Colloquia: main window loaded");
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  unregisterEndpoints();
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
