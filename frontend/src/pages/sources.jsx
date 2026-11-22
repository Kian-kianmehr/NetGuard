import React, { useMemo, useState } from "react";
import { deriveDisplayNationalSummary, describeCoverage } from "../public-status.js";
import { formatFaNumber as num, formatTime, safeText, asArray } from "../lib/data.js";
import { Badge, Card, DataBanner, DataMeta, EmptyState, LoadingState, Metric, Notice, SectionIntro, SelectTabs, Table } from "../components/ui.jsx";
import { SignalChart } from "../components/charts.jsx";

import * as shared from "./shared.jsx";

const { primaryNames, severity, freshness, providerStatus, toneForCondition, SignalStatus, ConditionCard, SignalSummaryCard, AiBrief, ProviderCard, friendlySignalName, observationAgeText, explainSignalInPlainLanguage, buildPlainIntelligenceSummary, forecastChangeText, forecastPlainDescription, PlainForecastCard } = shared;

export function SourcesPage({ dashboard, status, onRetry }) {
  const sources = asArray(dashboard?.sources);
  return (
    <div className="page-stack">
      <SectionIntro eyebrow="شفافیت منابع" title="منابع و وضعیت داده">
        برای هر منبع می‌توان آخرین مشاهده، وضعیت تازگی و ارائه‌دهنده را بررسی کرد.
      </SectionIntro>
      <DataBanner status={status} record={dashboard} onRetry={onRetry} />
      <Card title="فهرست منابع فعال" eyebrow="وضعیت آخرین مشاهده">
        <Table rows={sources} rowKey={(row) => row.source_id} columns={[
          { key: "display_name", label: "منبع", render: (row) => <strong>{safeText(row.display_name, row.source_id)}</strong> },
          { key: "provider", label: "ارائه‌دهنده" },
          { key: "signal", label: "شاخص" },
          { key: "freshness_status", label: "تازگی", render: (row) => <SignalStatus value={row.freshness_status} /> },
          { key: "last_observed_at", label: "آخرین مشاهده", render: (row) => formatTime(row.last_observed_at) },
          { key: "source_url", label: "پیوند", render: (row) => row.source_url ? <a href={row.source_url} target="_blank" rel="noreferrer">مستندات ↗</a> : "—" },
        ]} />
      </Card>
      <div className="source-reference-grid">
        <article><strong>IODA · Georgia Tech</strong><p>داده‌های BGP، پاسخ‌گویی و تلسکوپ شبکه برای سنجش وضعیت ملی.</p><a href="https://api.ioda.inetintel.cc.gatech.edu/v2/docs" target="_blank" rel="noreferrer">مستندات API ↗</a></article>
        <article><strong>OONI</strong><p>آزمون‌های داوطلبانهٔ دسترسی به وب‌سایت‌ها از داخل ایران.</p><a href="https://explorer.ooni.org/country/IR" target="_blank" rel="noreferrer">کاوشگر داده ↗</a></article>
        <article><strong>Citizen Lab</strong><p>فهرست دامنه‌های پیشنهادی برای آزمون؛ نه تأیید فیلترینگ.</p><a href="https://github.com/citizenlab/test-lists/blob/master/lists/ir.csv" target="_blank" rel="noreferrer">فهرست ایران ↗</a></article>
        <article><strong>صفحه‌های رسمی وضعیت</strong><p>وضعیت جهانی ارائه‌دهندگان؛ به معنی دسترسی از داخل ایران نیست.</p><a href="https://www.cloudflarestatus.com/" target="_blank" rel="noreferrer">Cloudflare Status ↗</a></article>
      </div>
    </div>
  );
}

