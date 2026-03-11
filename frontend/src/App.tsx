import { useState } from "react";
import SetupScreen from "./screens/SetupScreen";
import MainApp from "./screens/MainApp";
import { hasGeminiKey } from "./lib/apiKeys";
import { useTheme } from "./hooks/useTheme";

type AppScreen = "setup" | "main";

function App(): React.ReactElement {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>(
    hasGeminiKey() ? "main" : "setup",
  );
  const themeState = useTheme();

  const handleSetupComplete = (): void => {
    setCurrentScreen("main");
  };

  const handleBackToSetup = (): void => {
    setCurrentScreen("setup");
  };

  return (
    <div className="min-h-screen bg-surface-secondary text-text-primary">
      {currentScreen === "setup" ? (
        <SetupScreen onComplete={handleSetupComplete} />
      ) : (
        <MainApp onBackToSetup={handleBackToSetup} themeState={themeState} />
      )}
    </div>
  );
}

export default App;
