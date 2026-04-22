/**
 * Warm-paper design-system smoke test. Reachable only via `?style-guide=1`
 * in the URL. Purpose: visually verify tokens, primitives, typography,
 * palette switcher, and dark-mode toggle before any real page gets
 * restyled.
 *
 * This is a throwaway page. Once the full Settings surface lands (port
 * of CallAnalyzer's palette picker), this file can be deleted.
 */
import { useAppearance } from "@/components/appearance-provider";
import { PALETTES, type PaletteId, VALID_PALETTES } from "@/lib/palettes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  SectionHeader,
  PulseCard,
  StatBlock,
  ScoreDial,
  Sparkline,
  SentimentDot,
  Avatar,
} from "@/components/dashboard/primitives";

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

function TokenSwatch({ label, varName }: { label: string; varName: string }) {
  return (
    <div className="flex items-center gap-3 rounded-sm border border-border bg-card p-3">
      <div
        className="h-10 w-10 rounded-sm border border-border"
        style={{ background: `var(${varName})` }}
      />
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="font-mono text-xs text-muted-foreground">{varName}</div>
      </div>
    </div>
  );
}

export default function StyleGuide() {
  const { theme, palette, setTheme, setPalette } = useAppearance();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* App bar — document breadcrumb pattern from CallAnalyzer */}
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-7">
        <span
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 11, letterSpacing: "0.04em" }}
        >
          UMS Knowledge Base › Design › <span className="text-foreground">Style guide</span>
        </span>
      </div>

      {/* Page header */}
      <header className="border-b border-border bg-background px-4 pb-4 pt-6 sm:px-7">
        <SectionKicker>Phase 1 · Foundation</SectionKicker>
        <h1
          className="font-display font-medium text-foreground"
          style={{
            fontSize: "clamp(24px, 3vw, 30px)",
            letterSpacing: "-0.6px",
            lineHeight: 1.15,
            marginTop: 4,
          }}
        >
          Warm-paper design system
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Visual smoke test for the warm-paper token set, shadcn primitives, and the
          widened palette schema (accent + paper-tone recolor). Toggle theme and
          palette below to verify. Reachable only via <code className="font-mono">?style-guide=1</code>.
        </p>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-7">
        {/* Controls */}
        <section className="rounded-sm border border-border bg-card p-6">
          <SectionKicker>Controls</SectionKicker>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <Label className="font-mono uppercase text-xs">Theme</Label>
              <div className="mt-2 inline-flex rounded-sm border border-border bg-card p-0.5">
                {(["light", "dark"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTheme(t)}
                    aria-pressed={theme === t}
                    className={`rounded-sm px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider ${
                      theme === t
                        ? "bg-foreground text-background"
                        : "text-muted-foreground"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="font-mono uppercase text-xs">Palette</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {VALID_PALETTES.map((p) => (
                  <PaletteChip
                    key={p}
                    id={p}
                    active={palette === p}
                    onSelect={() => setPalette(p)}
                  />
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Non-default palettes recolor BOTH accent <em>and</em> paper-tone.
                Not available in CallAnalyzer — RAG-tool-exclusive capability to
                test paper harmonization.
              </p>
            </div>
          </div>
        </section>

        {/* Tokens */}
        <section>
          <SectionHeader kicker="Tokens" title="Semantic surfaces" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <TokenSwatch label="Paper (background)" varName="--background" />
            <TokenSwatch label="Paper 2 (muted)" varName="--paper-2" />
            <TokenSwatch label="Paper card" varName="--card" />
            <TokenSwatch label="Ink (foreground)" varName="--foreground" />
            <TokenSwatch label="Muted ink" varName="--muted-foreground" />
            <TokenSwatch label="Hairline (border)" varName="--border" />
            <TokenSwatch label="Accent (copper)" varName="--accent" />
            <TokenSwatch label="Accent soft" varName="--copper-soft" />
            <TokenSwatch label="Ring" varName="--ring" />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <TokenSwatch label="Conf · high → sage" varName="--conf-high" />
            <TokenSwatch label="Conf · partial → amber" varName="--conf-partial" />
            <TokenSwatch label="Conf · low → warm red" varName="--conf-low" />
          </div>
        </section>

        {/* Typography */}
        <section>
          <SectionHeader kicker="Typography" title="Three-font ramp" />
          <div className="mt-4 rounded-sm border border-border bg-card p-6">
            <p
              className="font-display font-medium text-foreground"
              style={{ fontSize: 32, letterSpacing: "-0.6px", lineHeight: 1.1 }}
            >
              Inter Tight · display headline
            </p>
            <p className="mt-3 max-w-2xl font-sans text-base leading-7 text-foreground">
              Inter · body copy. The knowledge base answers medical-supply questions
              grounded in company-specific documentation — HCPCS codes, LCD coverage,
              PAP/PPD forms, clinical notes, and more.
            </p>
            <p
              className="mt-3 font-mono text-muted-foreground"
              style={{ fontSize: 11, letterSpacing: "0.08em" }}
            >
              IBM PLEX MONO · METADATA · TIMESTAMPS · 2026-04-22 14:30:07 UTC
            </p>
          </div>
        </section>

        {/* Buttons */}
        <section>
          <SectionHeader kicker="Primitives" title="Buttons" />
          <div className="mt-4 flex flex-wrap gap-3 rounded-sm border border-border bg-card p-6">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
            <Button size="sm">Small</Button>
            <Button disabled>Disabled</Button>
          </div>
        </section>

        {/* Form fields */}
        <section>
          <SectionHeader kicker="Primitives" title="Form fields" />
          <div className="mt-4 grid gap-4 rounded-sm border border-border bg-card p-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sg-input">Question</Label>
              <Input id="sg-input" placeholder="What's the LCD criteria for a PMD?" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sg-textarea">Notes</Label>
              <Textarea id="sg-textarea" placeholder="Additional context for the reviewer…" />
            </div>
          </div>
        </section>

        {/* Cards + panels */}
        <section>
          <SectionHeader kicker="Primitives" title="Cards &amp; panels" />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>shadcn Card</CardTitle>
                <CardDescription>Hairline border, paper-card surface, radius 0.25rem.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Body text sits on the paper-card surface. Use this for structured
                  data tiles and dashboards.
                </p>
              </CardContent>
            </Card>
            <PulseCard kicker="Dashboard primitive" title="PulseCard">
              <p className="text-sm text-muted-foreground">
                The warm-paper document panel used across CallAnalyzer dashboards.
                Identical kicker + display-font header pattern.
              </p>
            </PulseCard>
          </div>
        </section>

        {/* Stat blocks + dashboard visuals */}
        <section>
          <SectionHeader kicker="Dashboard" title="Stats &amp; sparks" />
          <div
            className="mt-4 grid gap-8 border-y border-border bg-card px-6 py-6"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
          >
            <StatBlock
              label="Queries today"
              value="248"
              delta={12}
              spark={[120, 180, 160, 220, 200, 240, 248]}
            />
            <StatBlock
              label="Avg response"
              value="1.9"
              unit="s"
              delta={-0.3}
            />
            <StatBlock label="Cache hit rate" value="78" unit="%" />
            <StatBlock label="Flagged answers" value="3" delta={1} />
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-sm border border-border bg-card p-6">
              <SectionKicker>Score</SectionKicker>
              <div className="mt-3 flex items-center gap-4">
                <ScoreDial value={8.4} size={72} label="Confidence" />
                <div>
                  <div className="font-display text-xl">Confidence dial</div>
                  <div className="text-xs text-muted-foreground">
                    Tinted by tier via scoreTierColor()
                  </div>
                </div>
              </div>
            </div>
            <div className="rounded-sm border border-border bg-card p-6">
              <SectionKicker>Trend</SectionKicker>
              <div className="mt-3">
                <Sparkline
                  data={[3, 5, 4, 6, 7, 8, 6, 9, 8, 10, 9, 11]}
                  width={200}
                  height={48}
                />
                <div className="mt-2 font-mono text-[11px] text-muted-foreground">
                  12 · DATA POINTS · LAST 12H
                </div>
              </div>
            </div>
            <div className="rounded-sm border border-border bg-card p-6">
              <SectionKicker>Sentiment</SectionKicker>
              <div className="mt-3 flex items-center gap-3">
                <SentimentDot kind="positive" />
                <span className="text-sm">Positive</span>
                <SentimentDot kind="neutral" />
                <span className="text-sm">Neutral</span>
                <SentimentDot kind="negative" />
                <span className="text-sm">Negative</span>
              </div>
              <Separator className="my-3" />
              <div className="flex items-center gap-2">
                <Avatar initials="JR" size={32} />
                <div className="text-sm">Jane Reviewer</div>
              </div>
            </div>
          </div>
        </section>

        {/* Confidence pills */}
        <section>
          <SectionHeader kicker="RAG" title="Confidence semantics" />
          <div className="mt-4 flex flex-wrap gap-3 rounded-sm border border-border bg-card p-6">
            <ConfidencePill level="high" />
            <ConfidencePill level="partial" />
            <ConfidencePill level="low" />
            <Badge variant="secondary">Badge · secondary</Badge>
            <Badge variant="outline">Badge · outline</Badge>
            <Badge variant="destructive">Badge · destructive</Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Confidence aliases (<code className="font-mono">--conf-high/partial/low</code>)
            map to sage / amber / warm-red. Existing RAG chat + source-viewer color
            logic keeps its meaning under warm-paper.
          </p>
        </section>

        {/* Skeleton */}
        <section>
          <SectionHeader kicker="Primitives" title="Loading skeleton" />
          <div className="mt-4 space-y-3 rounded-sm border border-border bg-card p-6">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-20 w-full" />
          </div>
        </section>

        <div className="py-6 text-center font-mono text-[11px] text-muted-foreground">
          End of style guide · remove <code>?style-guide=1</code> to return to the app.
        </div>
      </main>
    </div>
  );
}

function PaletteChip({
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
      className={`flex items-center gap-2 rounded-sm border px-3 py-1.5 text-sm ${
        active ? "border-accent bg-[var(--copper-soft)]" : "border-border bg-card"
      }`}
    >
      <span
        className="inline-block h-4 w-4 rounded-full border border-border"
        style={{ background: p.light.accent }}
      />
      <span className="font-medium">{p.label}</span>
    </button>
  );
}

function ConfidencePill({ level }: { level: "high" | "partial" | "low" }) {
  const label = level === "high" ? "High confidence" : level === "partial" ? "Partial match" : "Low confidence";
  return (
    <span
      className="inline-flex items-center rounded-sm border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider"
      style={{
        background: `var(--conf-${level}-bg)`,
        borderColor: `var(--conf-${level}-border)`,
        color: `var(--conf-${level})`,
      }}
    >
      {label}
    </span>
  );
}
