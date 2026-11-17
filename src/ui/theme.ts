export type Theme = "light" | "dark";

const KEY = "edge-guard-theme";

/** Light is the default; dark is a per-viewer preference kept in this browser only. */
export function storedTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the theme still applies.
  }
}
