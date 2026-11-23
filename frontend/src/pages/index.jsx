import React from "react";
import { OverviewPage, QualityPage } from "./overview.jsx";
import { CensorshipPage } from "./censorship.jsx";
import { ProvidersPage } from "./providers.jsx";
import { IntelligencePage } from "./intelligence.jsx";
import { AnalysisPage } from "./analysis.jsx";
import { SignalsPage } from "./signals.jsx";
import { EventsPage } from "./events.jsx";
import { SourcesPage } from "./sources.jsx";
import { MethodPage } from "./method.jsx";

// Keep page modules in the initial application graph. The dashboard is small
// enough for a single reliable bootstrap; navigation must never depend on a
// late dynamic-import chunk being fetched successfully.
export default function PageContent({ page, items, statuses, hours, onHours, onRefresh, onNavigate }) {
  const dashboardKey = "dashboard_" + hours;
  const intelligenceKey = "intelligence_" + hours;
  const dashboard = items[dashboardKey] || null;
  const dashboardStatus = statuses[dashboardKey] || {};
  const intelligenceRecord = items[intelligenceKey] || null;
  const intelligenceStatus = statuses[intelligenceKey] || {};
  const retryDashboard = () => onRefresh([dashboardKey], true);
  const retryIntelligence = () => onRefresh([intelligenceKey], true);

  switch (page) {
    case "overview":
      return <OverviewPage dashboard={dashboard} dashboardStatus={dashboardStatus} onRetry={retryDashboard} hours={hours} onHours={onHours} onNavigate={onNavigate} />;
    case "quality":
      return <QualityPage dashboard={dashboard} status={dashboardStatus} onRetry={retryDashboard} hours={hours} onHours={onHours} />;
    case "censorship":
      return <CensorshipPage data={items.censorship} status={statuses.censorship} onRetry={() => onRefresh(["censorship"], true)} />;
    case "providers":
      return <ProvidersPage
        providersData={items.providers_status}
        datacenters={items.iran_datacenters}
        providerStatus={statuses.providers_status}
        datacenterStatus={statuses.iran_datacenters}
        onRetryProviders={() => onRefresh(["providers_status"], true)}
        onRetryDatacenters={() => onRefresh(["iran_datacenters"], true)}
      />;
    case "intelligence":
      return <IntelligencePage record={intelligenceRecord} status={intelligenceStatus} onRetry={retryIntelligence} />;
    case "analysis":
      return <AnalysisPage dashboard={dashboard} status={dashboardStatus} onRetry={retryDashboard} />;
    case "signals":
      return <SignalsPage dashboard={dashboard} status={dashboardStatus} onRetry={retryDashboard} hours={hours} onHours={onHours} />;
    case "events":
      return <EventsPage dashboard={dashboard} status={dashboardStatus} onRetry={retryDashboard} />;
    case "sources":
      return <SourcesPage dashboard={dashboard} status={dashboardStatus} onRetry={retryDashboard} />;
    default:
      return <MethodPage />;
  }
}
