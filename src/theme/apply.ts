import { THEMES, deriveThemeTokens } from "./themes.mjs";
import type { Settings } from "../../shared/imago";
export function applyTheme(settings: Settings) {
  const root = document.documentElement;
  const mode =
    settings.mode === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : settings.mode;
  root.classList.toggle("dark", mode === "dark");
  root.classList.toggle("light", mode === "light");
  root.lang = settings.language;
  const def =
    settings.theme === "custom"
      ? {
          id: "custom",
          label: "Custom",
          anchors: {
            accent: settings.accent,
            deep: "#0a0a0a",
            pale: "#fafafa",
            lightText: "#171717",
            darkText: "#f5f5f5",
            appBackground: { light: "#f5f5f5", dark: "#0a0a0a" },
            tint: 0.04,
          },
        }
      : THEMES.find((t) => t.id === settings.theme);
  const tokens = def ? deriveThemeTokens(def) : null;
  for (const shade of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950])
    for (const name of ["n", "a"]) {
      const value = tokens
        ? name === "n"
          ? tokens.n[shade as keyof typeof tokens.n]
          : tokens.a[mode][shade as keyof typeof tokens.n]
        : undefined;
      if (value) root.style.setProperty(`--${name}-${shade}`, value);
      else root.style.removeProperty(`--${name}-${shade}`);
    }
  for (const [key, value] of Object.entries({
    "--theme-text-light": tokens?.text.light,
    "--theme-text-dark": tokens?.text.dark,
    "--app-background-light": tokens?.appBackground.light,
    "--app-background-dark": tokens?.appBackground.dark,
  }))
    if (value) root.style.setProperty(key, value);
    else root.style.removeProperty(key);
  localStorage.setItem("imago.appearance", JSON.stringify(settings));
}
try {
  const settings = JSON.parse(
    localStorage.getItem("imago.appearance") ?? "null",
  );
  if (settings) applyTheme(settings);
} catch {}
