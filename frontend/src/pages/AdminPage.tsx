import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ObservabilityDashboard } from "@/components/ObservabilityDashboard";
import { QualityDashboard } from "@/components/QualityDashboard";
import { FaqDashboard } from "@/components/FaqDashboard";
import { QueryLogViewer } from "@/components/QueryLogViewer";
import { UsageLimitsManager } from "@/components/UsageLimitsManager";
import { UserManagement } from "@/components/UserManagement";
import { ProductImageManager } from "@/components/ProductImageManager";
import { ExtractionQualityStatsCard } from "@/components/ExtractionQualityStatsCard";
import { SourceStalenessManager } from "@/components/SourceStalenessManager";
import { RagEvalDatasetViewer } from "@/components/RagEvalDatasetViewer";

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

/**
 * Admin landing page — hosts the 10 admin dashboards currently stacked
 * vertically. In Phase 3 this becomes a collapsible sidebar section with
 * per-dashboard routes; for now it's a straight extraction from the
 * pre-port App.tsx so behavior is unchanged.
 */
export default function AdminPage() {
  return (
    <div className="min-h-full bg-background">
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-7">
        <span
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 11, letterSpacing: "0.04em" }}
        >
          UMS Knowledge › <span className="text-foreground">Admin</span>
        </span>
      </div>

      <header className="border-b border-border bg-background px-4 pb-4 pt-6 sm:px-7">
        <SectionKicker>Administration</SectionKicker>
        <h1
          className="font-display font-medium text-foreground"
          style={{
            fontSize: "clamp(24px, 3vw, 30px)",
            letterSpacing: "-0.6px",
            lineHeight: 1.15,
            marginTop: 4,
          }}
        >
          Admin dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Analytics, query logs, and knowledge base insights.
        </p>
      </header>

      <div className="flex flex-col gap-2 px-4 py-6 sm:px-7">
        <ErrorBoundary fallbackMessage="Observability dashboard encountered an error.">
          <ObservabilityDashboard />
        </ErrorBoundary>
        <ErrorBoundary fallbackMessage="Quality dashboard encountered an error.">
          <QualityDashboard />
        </ErrorBoundary>
        <ErrorBoundary fallbackMessage="FAQ dashboard encountered an error.">
          <FaqDashboard />
        </ErrorBoundary>
        <ErrorBoundary fallbackMessage="Query log viewer encountered an error.">
          <QueryLogViewer />
        </ErrorBoundary>
        <ErrorBoundary fallbackMessage="Usage manager encountered an error.">
          <UsageLimitsManager />
        </ErrorBoundary>
        <ErrorBoundary fallbackMessage="User management encountered an error.">
          <UserManagement />
        </ErrorBoundary>
        <ErrorBoundary fallbackMessage="Product image manager encountered an error.">
          <ProductImageManager />
        </ErrorBoundary>
        <ErrorBoundary fallbackMessage="Extraction quality stats encountered an error.">
          <ExtractionQualityStatsCard />
        </ErrorBoundary>
        <ErrorBoundary fallbackMessage="Source staleness view encountered an error.">
          <SourceStalenessManager />
        </ErrorBoundary>
        <ErrorBoundary fallbackMessage="RAG eval dataset view encountered an error.">
          <RagEvalDatasetViewer />
        </ErrorBoundary>
      </div>
    </div>
  );
}
