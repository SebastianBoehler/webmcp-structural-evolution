import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";

const storageKey = "structural-evolution-theme";

function initialTheme(): ThemePreference {
  const saved = window.localStorage.getItem(storageKey);
  return saved === "light" || saved === "dark" ? saved : "system";
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);

  useEffect(() => {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
      window.localStorage.removeItem(storageKey);
    } else {
      document.documentElement.dataset.theme = theme;
      window.localStorage.setItem(storageKey, theme);
    }
  }, [theme]);

  return { theme, setTheme } as const;
}
