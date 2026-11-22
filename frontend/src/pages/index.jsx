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

export default function PageContent({ page, items, statuses, hours, onHours, onRefresh, onNavigate }) {
  const dashboardKey = "dashboard_" + hours;
  const dashboard = items[dashboardKey] || null;
  const dashboardStatus = statuses[dashboardKey] || {};
  if (page === "overview") return <OverviewPage dashboard={dashboard} dashboardStatus={dashboardStatus} onRetry={() => onRefresh([dashboardKey], true)} hours={hours} onHours={onHours} onNavigate={onNavigate} />;
  if (page === "quality") return <QualityPage dashboard={dashboard} status={dashboardStatus} onRetry={() => onRefresh([dashboardKey], true)} hours={hours} onHours={onHours} />;
  if (page === "censorship") return <CensorshipPage data={items.censorship} status={statuses.censorship} onRetry={() => onRefresh(["censorship"], true)} />;
  if (page === "providers") return <ProvidersPage
    providersData={items.providers_status}
    datacenters={items.iran_datacenters}
    providerStatus={statuses.providers_status}
    datacenterStatus={statuses.iran_datacenters}
    onRetryProviders={() => onRefresh(["providers_status"], true)}
    onRetryDatacenters={() => onRefresh(["iran_datacenters"], true)}
  />;
  if (page === "intelligence") return <IntelligencePage dashboard={dashboard} status={dashboardStatus} onRetry={() => onRefresh([dashboardKey], true)} />;
  if (page === "analysis") return <AnalysisPage dashboard={dashboard} status={dashboardStatus} onRetry={() => onRefresh([dashboardKey], true)} />;
  if (page === "signals") return <SignalsPage dashboard={dashboard} status={dashboardStatus} onRetry={() => onRefresh([dashboardKey], true)} hours={hours} onHours={onHours} />;
  if (page === "events") return <EventsPage dashboard={dashboard} status={dashboardStatus} onRetry={() => onRefresh([dashboardKey], true)} />;
  if (page === "sources") return <SourcesPage dashboard={dashboard} status={dashboardStatus} onRetry={() => onRefresh([dashboardKey], true)} />;
  return <MethodPage />;
}

