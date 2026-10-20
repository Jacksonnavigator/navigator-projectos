export type Theme = "light" | "dark" | "system";

const KEY = "nav-theme";

export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // storage blocked: fall through to system
  }
  return "system";
}

export function applyTheme(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", Boolean(dark));
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // ignore
  }
}
