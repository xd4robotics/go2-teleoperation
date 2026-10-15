import { useLayoutEffect, useState } from "react";

import AppRoutes from "./routes/AppRoutes";

const STORAGE_KEY = "xd4-theme-v2";

function getInitialTheme() {
  const savedTheme = window.localStorage.getItem(STORAGE_KEY);
  if (savedTheme === "light" || savedTheme === "dark") {
    return savedTheme;
  }
  return "dark";
}

function App() {
  const [theme, setTheme] = useState(getInitialTheme);
  const isDarkMode = theme === "dark";

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <div className={isDarkMode ? "app-theme dark-mode" : "app-theme"}>
      <AppRoutes
        isDarkMode={isDarkMode}
        onToggleTheme={() =>
          setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"))
        }
      />
    </div>
  );
}

export default App;
