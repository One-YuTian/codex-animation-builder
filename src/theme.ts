import { applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import { darkTheme, lightTheme } from "@galacean/editor-ui";

type Theme = "light" | "dark";
let hasHostTheme = false;
let initialized = false;

function applyTheme(theme: Theme, source: "host" | "system") {
  const root = document.documentElement;
  applyDocumentTheme(theme);
  root.dataset.theme = theme;
  root.dataset.themeSource = source;
  root.style.colorScheme = theme;
  root.classList.remove(darkTheme.className, lightTheme.className);
  root.classList.add(
    theme === "light" ? lightTheme.className : darkTheme.className,
  );
}

export function initializeTheme() {
  if (initialized) return;
  initialized = true;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const applySystem = () => {
    if (!hasHostTheme) applyTheme(media.matches ? "dark" : "light", "system");
  };
  applySystem();
  media.addEventListener("change", applySystem);
}

export function applyHostTheme(theme: unknown) {
  if (theme !== "light" && theme !== "dark") return;
  hasHostTheme = true;
  applyTheme(theme, "host");
}
