/**
 * Palette registry for the warm-paper design system (RAG tool variant).
 *
 * RAG tool extends CallAnalyzer's accent-only palette system to ALSO
 * recolor the paper-tone background per palette. This lets us trial
 * whether a background that harmonizes with the accent reads better
 * than a single cream paper across every accent choice.
 *
 * The baseline (`copper`) keeps the warm-paper cream exactly — no
 * override injected. Non-default palettes inject a wider <style>
 * block that redefines both accent AND paper tokens.
 *
 * Picking paper-tone values (design rule): keep L ≥ 95% and C ≤ 0.02 in
 * light mode so the surface still reads as "paper" rather than "tinted
 * page". The hue is pulled from the accent. Dark-mode paper tones stay
 * cool-neutral to avoid a muddy warm dark mode.
 */

export type PaletteId =
  | "copper"
  | "medicalBlue"
  | "corporateBlue"
  | "skyBlue"
  | "indigo"
  | "sage";

export interface PaperTokens {
  /** Page canvas — the dominant warm-paper surface */
  paper: string;
  /** Secondary surface — slightly tinted (muted panels, filter bars) */
  paper2: string;
  /** Elevated surface — cards and popovers. Usually white-ish in light mode. */
  paperCard: string;
  /** Primary text color on paper */
  ink: string;
  /** Muted text (kickers, timestamps, helper copy) */
  mutedInk: string;
  /** Hairline border color */
  hairline: string;
}

export interface AccentTokens {
  /** --copper in the CSS */
  accent: string;
  /** --copper-soft in the CSS */
  accentSoft: string;
}

export interface PaletteDef {
  id: PaletteId;
  label: string;
  description: string;
  /** Light-mode tokens */
  light: AccentTokens & PaperTokens;
  /** Dark-mode tokens */
  dark: AccentTokens & PaperTokens;
}

/** Baseline warm-paper light tones — shared by the default palette.
 *  Non-default palettes override these with hue-tinted variants. */
const BASE_LIGHT_PAPER: PaperTokens = {
  paper: "oklch(97% 0.008 85)",
  paper2: "oklch(94% 0.012 82)",
  paperCard: "hsl(0, 0%, 100%)",
  ink: "oklch(19% 0.02 40)",
  mutedInk: "oklch(52% 0.018 60)",
  hairline: "oklch(89% 0.012 70)",
};

/** Baseline dark-mode surfaces — cool neutral, shared across palettes to
 *  avoid a dissonant warm-tinted dark surface. Only accent shifts in dark. */
const BASE_DARK_PAPER: PaperTokens = {
  paper: "hsl(220, 28%, 7%)",
  paper2: "hsl(220, 25%, 11%)",
  paperCard: "hsl(220, 25%, 9%)",
  ink: "hsl(36, 20%, 92%)",
  mutedInk: "hsl(30, 10%, 60%)",
  hairline: "hsl(220, 18%, 18%)",
};

export const PALETTES: Record<PaletteId, PaletteDef> = {
  copper: {
    id: "copper",
    label: "Warm Copper",
    description: "Default. Warm-paper cream with copper accent.",
    light: {
      ...BASE_LIGHT_PAPER,
      accent: "oklch(62% 0.12 52)",
      accentSoft: "oklch(92% 0.05 55)",
    },
    dark: {
      ...BASE_DARK_PAPER,
      accent: "oklch(70% 0.12 52)",
      accentSoft: "oklch(30% 0.06 52)",
    },
  },
  medicalBlue: {
    id: "medicalBlue",
    label: "Medical Blue",
    description: "Clean and clinical. Cool-tinted paper with medical-blue accent.",
    light: {
      paper: "oklch(97% 0.008 230)",
      paper2: "oklch(94% 0.012 230)",
      paperCard: "hsl(0, 0%, 100%)",
      ink: "oklch(20% 0.02 230)",
      mutedInk: "oklch(52% 0.018 230)",
      hairline: "oklch(89% 0.012 230)",
      accent: "oklch(55% 0.15 230)",
      accentSoft: "oklch(94% 0.04 230)",
    },
    dark: {
      ...BASE_DARK_PAPER,
      accent: "oklch(72% 0.13 230)",
      accentSoft: "oklch(32% 0.07 230)",
    },
  },
  corporateBlue: {
    id: "corporateBlue",
    label: "Corporate Blue",
    description: "Muted. Cool paper with business-classic blue accent.",
    light: {
      paper: "oklch(97% 0.007 240)",
      paper2: "oklch(94% 0.010 240)",
      paperCard: "hsl(0, 0%, 100%)",
      ink: "oklch(20% 0.02 240)",
      mutedInk: "oklch(52% 0.018 240)",
      hairline: "oklch(89% 0.010 240)",
      accent: "oklch(52% 0.13 240)",
      accentSoft: "oklch(94% 0.04 240)",
    },
    dark: {
      ...BASE_DARK_PAPER,
      accent: "oklch(70% 0.13 240)",
      accentSoft: "oklch(30% 0.07 240)",
    },
  },
  skyBlue: {
    id: "skyBlue",
    label: "Sky Blue",
    description: "Lighter, airier paper with soft sky accent.",
    light: {
      paper: "oklch(97% 0.006 220)",
      paper2: "oklch(95% 0.009 220)",
      paperCard: "hsl(0, 0%, 100%)",
      ink: "oklch(20% 0.02 220)",
      mutedInk: "oklch(52% 0.018 220)",
      hairline: "oklch(89% 0.010 220)",
      accent: "oklch(60% 0.10 220)",
      accentSoft: "oklch(95% 0.03 220)",
    },
    dark: {
      ...BASE_DARK_PAPER,
      accent: "oklch(76% 0.10 220)",
      accentSoft: "oklch(30% 0.05 220)",
    },
  },
  indigo: {
    id: "indigo",
    label: "Deep Indigo",
    description: "Richer paper with saturated indigo accent.",
    light: {
      paper: "oklch(97% 0.008 250)",
      paper2: "oklch(94% 0.012 250)",
      paperCard: "hsl(0, 0%, 100%)",
      ink: "oklch(20% 0.02 250)",
      mutedInk: "oklch(52% 0.018 250)",
      hairline: "oklch(89% 0.012 250)",
      accent: "oklch(48% 0.15 250)",
      accentSoft: "oklch(94% 0.04 250)",
    },
    dark: {
      ...BASE_DARK_PAPER,
      accent: "oklch(70% 0.13 250)",
      accentSoft: "oklch(30% 0.07 250)",
    },
  },
  sage: {
    id: "sage",
    label: "Sage Forest",
    description: "Calm green-tinted paper with sage accent.",
    light: {
      paper: "oklch(97% 0.008 150)",
      paper2: "oklch(94% 0.012 150)",
      paperCard: "hsl(0, 0%, 100%)",
      ink: "oklch(20% 0.02 150)",
      mutedInk: "oklch(52% 0.018 150)",
      hairline: "oklch(89% 0.012 150)",
      accent: "oklch(52% 0.11 150)",
      accentSoft: "oklch(94% 0.05 150)",
    },
    dark: {
      ...BASE_DARK_PAPER,
      accent: "oklch(68% 0.10 150)",
      accentSoft: "oklch(30% 0.06 150)",
    },
  },
};

export const VALID_PALETTES: PaletteId[] = Object.keys(PALETTES) as PaletteId[];
export const DEFAULT_PALETTE: PaletteId = "copper";

/**
 * Returns the CSS text to inject into <style id="palette-override">.
 *
 * For the default palette (copper), returns an empty string — the baseline
 * values in index.css already apply. For non-default palettes, redefines
 * the full token set (paper-tone + accent) in both :root and .dark so
 * every downstream alias (--background, --primary, --ring, etc.) updates.
 */
export function paletteCss(id: PaletteId): string {
  if (id === DEFAULT_PALETTE) return "";
  const p = PALETTES[id];
  return [
    ":root{",
    `--paper:${p.light.paper};`,
    `--paper-2:${p.light.paper2};`,
    `--paper-card:${p.light.paperCard};`,
    `--ink:${p.light.ink};`,
    `--muted-ink:${p.light.mutedInk};`,
    `--hairline:${p.light.hairline};`,
    `--copper:${p.light.accent};`,
    `--copper-soft:${p.light.accentSoft};`,
    "}",
    ".dark{",
    `--paper:${p.dark.paper};`,
    `--paper-2:${p.dark.paper2};`,
    `--paper-card:${p.dark.paperCard};`,
    `--ink:${p.dark.ink};`,
    `--muted-ink:${p.dark.mutedInk};`,
    `--hairline:${p.dark.hairline};`,
    `--copper:${p.dark.accent};`,
    `--copper-soft:${p.dark.accentSoft};`,
    "}",
  ].join("");
}
