/**
 * Appearance preferences (theme + palette), persisted to localStorage.
 *
 * Keyed under separate storage slots so theme persistence behavior (which
 * the inline <script> in index.html also reads) stays compatible with
 * the existing `ums-dark-mode` boolean flag the RAG tool used pre-port.
 */

import { DEFAULT_PALETTE, VALID_PALETTES, type PaletteId } from "./palettes";

export type Theme = "light" | "dark";

export interface AppearancePrefs {
  theme: Theme;
  palette: PaletteId;
}

const THEME_KEY = "ums-dark-mode"; // boolean string — matches pre-port key
const PALETTE_KEY = "ums-palette";

function safeRead(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // swallow quota / Safari-private-mode errors — persistence is best-effort
  }
}

function resolveInitialTheme(): Theme {
  const stored = safeRead(THEME_KEY);
  if (stored === "true") return "dark";
  if (stored === "false") return "light";
  // No stored preference — fall back to OS setting
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function resolveInitialPalette(): PaletteId {
  const stored = safeRead(PALETTE_KEY);
  if (stored && VALID_PALETTES.includes(stored as PaletteId)) {
    return stored as PaletteId;
  }
  return DEFAULT_PALETTE;
}

export function loadAppearance(): AppearancePrefs {
  return {
    theme: resolveInitialTheme(),
    palette: resolveInitialPalette(),
  };
}

export function saveAppearance(prefs: AppearancePrefs): void {
  safeWrite(THEME_KEY, prefs.theme === "dark" ? "true" : "false");
  safeWrite(PALETTE_KEY, prefs.palette);
}
