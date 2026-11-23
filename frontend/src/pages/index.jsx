import React, { lazy, Suspense } from "react";

const OverviewPage = lazy(() => import("./overview.jsx").then((module) => ({ default: module.OverviewPage })));
const QualityPage = lazy(() => import("./overview.jsx").then((module) => ({ default: module.QualityPage })));
const CensorshipPage = lazy(() => import("./censorship.jsx").then((module) => ({ default: module.CensorshipPage })));
const ProvidersPage = lazy(() => import("./providers.jsx").then((module) => ({ default: module.ProvidersPage })));
const IntelligencePage = lazy(() => import("./intelligence.jsx").then((module) => ({ default: module.IntelligencePage })));
const AnalysisPage = lazy(() => import("./analysis.jsx").then((module) => ({ default: module.AnalysisPage })));
const SignalsPage = lazy(() => import("./signals.jsx").then((module) => ({ default: module.SignalsPage })));
const EventsPage = lazy(() => import("./events.jsx").then((module) => ({ default: module.EventsPage })));
const SourcesPage = lazy(() => import("./sources.jsx").then((module) => ({ default: module.SourcesPage })));
const MethodPage = lazy(() => import("./method.jsx").then((module) => ({ default: module.MethodPage })));

export default function PageContent({ page, items, statuses, hours, onHours, onRefresh, onNavigate }) {
  const dashboardKey = "dashboard_" + hours;
  const dashboard = items[dashboardKey] || null;
  const dashboardStatus = statuses[dashboardKey] || {};
  const retryDashboard = () => onRefresh([dashboardKey], true);

  let Page = MethodPage;
  let pageProps = {};

  switch (page) {
    case "overview":
      Page = OverviewPage;
      pageProps = { dashboard, dashboardStatus, onRetry: retryDashboard, hours, onHours, onNavigate };
      break;
    case "quality":
      Page = QualityPage;
      pageProps = { dashboard, status: dashboardStatus, onRetry: retryDashboard, hours, onHours };
      break;
    case "censorship":
      Page = CensorshipPage;
      pageProps = { data: items.censorship, status: statuses.censorship, onRetry: () => onRefresh(["censorship"], true) };
      break;
    case "providers":
      Page = ProvidersPage;
      pageProps = {
        providersData: items.providers_status,
        datacenters: items.iran_datacenters,
        providerStatus: statuses.providers_status,
        datacenterStatus: statuses.iran_datacenters,
        onRetryProviders: () => onRefresh(["providers_status"], true),
        onRetryDatacenters: () => onRefresh(["iran_datacenters"], true),
      };
      break;
    case "intelligence":
      Page = IntelligencePage;
      pageProps = { dashboard, status: dashboardStatus, onRetry: retryDashboard };
      break;
    case "analysis":
      Page = AnalysisPage;
      pageProps = { dashboard, status: dashboardStatus, onRetry: retryDashboard };
      break;
    case "signals":
      Page = SignalsPage;
      pageProps = { dashboard, status: dashboardStatus, onRetry: retryDashboard, hours, onHours };
      break;
    case "events":
      Page = EventsPage;
      pageProps = { dashboard, status: dashboardStatus, onRetry: retryDashboard };
      break;
    case "sources":
      Page = SourcesPage;
      pageProps = { dashboard, status: dashboardStatus, onRetry: retryDashboard };
      break;
    default:
      Page = MethodPage;
  }

  return (
    <Suspense fallback={<div className="loading-state"><span className="spinner" /><span>در حال بارگذاری بخش...</span></div>}>
      <Page {...pageProps} />
    </Suspense>
  );
}
