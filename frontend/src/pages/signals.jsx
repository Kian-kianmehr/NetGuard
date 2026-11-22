import React, { useMemo, useState } from "react";
import { deriveDisplayNationalSummary, describeCoverage } from "../public-status.js";
import { formatFaNumber as num, formatTime, safeText, asArray } from "../lib/data.js";
import { Badge, Card, DataBanner, DataMeta, EmptyState, LoadingState, Metric, Notice, SectionIntro, SelectTabs, Table } from "../components/ui.jsx";
import { SignalChart } from "../components/charts.jsx";

import * as shared from "./shared.jsx";

const { primaryNames, severity, freshness, providerStatus, toneForCondition, SignalStatus, ConditionCard, SignalSummaryCard, AiBrief, ProviderCard, friendlySignalName, observationAgeText, explainSignalInPlainLanguage, buildPlainIntelligenceSummary, forecastChangeText, forecastPlainDescription, PlainForecastCard } = shared;

export function SignalsPage({ dashboard, status, onRetry, hours, onHours }) {
  const analysis = dashboard?.analysis || {};
  const signals = asArray(analysis.signals);
  const observations = asArray(dashboard?.observations);
  return (
    <div className="page-stack">
      <SectionIntro eyebrow="دادهٔ خام و روند تاریخی" title="سیگنال‌های شبکه">
        نمودار هر شاخص با مقیاس خودش رسم می‌شود؛ از مقایسهٔ مستقیم عددهای دارای واحد متفاوت خودداری می‌کنیم.
      </SectionIntro>
      <DataBanner status={status} record={dashboard} onRetry={onRetry} />
      <SelectTabs value={hours} onChange={onHours} label="بازهٔ نمودار" options={[{ value: 24, label: "۲۴ ساعت" }, { value: 72, label: "۳ روز" }, { value: 168, label: "۷ روز" }]} />
      {signals.length ? signals.map((signal) => <SignalSummaryCard key={signal.source_id} signal={signal} observations={observations} />) : <EmptyState title="سیگنالی موجود نیست" detail="پس از دریافت Snapshot ملی، نمودارها نمایش داده می‌شوند." />}
    </div>
  );
}

