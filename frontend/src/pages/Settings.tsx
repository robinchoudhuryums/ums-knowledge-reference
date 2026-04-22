import { useAppearance } from "@/components/appearance-provider";
import { PALETTES, VALID_PALETTES, type PaletteId } from "@/lib/palettes";
import type { Theme } from "@/lib/appearance";

function SectionKicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono uppercase text-muted-foreground"
      style={{ fontSize: 10, letterSpacing: "0.14em" }}
    >
      {children}
    </div>
  );
}

function SectionHeader({ kicker, title, description }: { kicker: string; title: string; description?: string }) {
  return (
    <div className="mb-4">
      <SectionKicker>{kicker}</SectionKicker>
      <h2
        className="font-display font-medium text-foreground"
        style={{ fontSize: 20, letterSpacing: "-0.2px", marginTop: 2 }}
      >
        {title}
      </h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const { theme, palette, setTheme, setPalette } = useAppearance();

  return (
    <div className="min-h-full bg-background">
      {/* App bar breadcrumb */}
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-7">
        <span
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 11, letterSpacing: "0.04em" }}
        >
          UMS Knowledge › <span className="text-foreground">Settings</span>
        </span>
      </div>

      {/* Page header */}
      <header className="border-b border-border bg-background px-4 pb-4 pt-6 sm:px-7">
        <SectionKicker>Appearance</SectionKicker>
        <h1
          className="font-display font-medium text-foreground"
          style={{
            fontSize: "clamp(24px, 3vw, 30px)",
            letterSpacing: "-0.6px",
            lineHeight: 1.15,
            marginTop: 4,
          }}
        >
          Settings
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Customize the look of the knowledge base. Preferences persist in this browser.
        </p>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-7">
        {/* Theme */}
        <section className="rounded-sm border border-border bg-card p-6">
          <SectionHeader kicker="Theme" title="Light or dark" description="Dark mode also adapts automatically to your OS preference on first visit." />
          <div className="inline-flex rounded-sm border border-border bg-card p-0.5">
            {(["light", "dark"] as const).map((t: Theme) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                aria-pressed={theme === t}
                className={`rounded-sm px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                  theme === t ? "bg-foreground text-background" : "text-muted-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        {/* Palette */}
        <section className="rounded-sm border border-border bg-card p-6">
          <SectionHeader
            kicker="Palette"
            title="Accent &amp; paper tone"
            description="Picks the accent color (buttons, active nav, focus rings) AND the paper-tone background. Try different palettes to see which reads best to you — not every hue holds up as 'paper', so unlike CallAnalyzer this recolor is experimental."
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {VALID_PALETTES.map((id) => (
              <PaletteCard key={id} id={id} active={palette === id} onSelect={() => setPalette(id)} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function PaletteCard({
  id,
  active,
  onSelect,
}: {
  id: PaletteId;
  active: boolean;
  onSelect: () => void;
}) {
  const p = PALETTES[id];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`flex items-stretch gap-3 rounded-sm border p-3 text-left transition-colors ${
        active
          ? "border-accent bg-[var(--copper-soft)]"
          : "border-border bg-card hover:bg-muted"
      }`}
    >
      {/* Swatch column: paper + accent stacked so the user sees BOTH tokens the palette controls */}
      <div className="flex flex-col gap-1.5">
        <div
          className="h-8 w-8 rounded-sm border border-border"
          style={{ background: p.light.paper }}
          aria-hidden="true"
        />
        <div
          className="h-8 w-8 rounded-sm border border-border"
          style={{ background: p.light.accent }}
          aria-hidden="true"
        />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{p.label}</div>
        <div className="mt-1 text-xs leading-snug text-muted-foreground">{p.description}</div>
      </div>
    </button>
  );
}
