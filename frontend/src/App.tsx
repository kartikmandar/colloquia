import { useState } from "react";
import SetupScreen from "./screens/SetupScreen";
import MainApp from "./screens/MainApp";
import { hasGeminiKey } from "./lib/apiKeys";

type AppScreen = "setup" | "main";

function App(): React.ReactElement {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>(
    hasGeminiKey() ? "main" : "setup"
  );

  const handleSetupComplete = (): void => {
    setCurrentScreen("main");
  };

  const handleBackToSetup = (): void => {
    setCurrentScreen("setup");
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {currentScreen === "setup" ? (
        <SetupScreen onComplete={handleSetupComplete} />
      ) : (
        <MainApp onBackToSetup={handleBackToSetup} />
      )}
    </div>
  );
}

export default App;
