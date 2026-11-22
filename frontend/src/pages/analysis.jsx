import React, { useMemo, useState } from "react";
import { deriveDisplayNationalSummary, describeCoverage } from "../public-status.js";
import { formatFaNumber as num, formatTime, safeText, asArray } from "../lib/data.js";
import { Badge, Card, DataBanner, DataMeta, EmptyState, LoadingState, Metric, Notice, SectionIntro, SelectTabs, Table } from "../components/ui.jsx";
import { SignalChart } from "../components/charts.jsx";

import { SignalStatus, ConditionCard } from "./shared.jsx";

export function AnalysisPage({ dashboard, status, onRetry }) {
  const analysis = dashboard?.analysis || {};
  const signals = asArray(analysis.signals);
  const summary = deriveDisplayNationalSummary(analysis.public_summary, signals);
  const quality = analysis.data_quality || {};
  return (
    <div className="page-stack">
      <SectionIntro eyebrow="ارزیابی چندمنبعی" title="تحلیل وضعیت شبکه">
        وضعیت شاخص‌های اصلی، کیفیت تاریخچه و محدودیت شواهد را در کنار هم ببین.
      </SectionIntro>
      <DataBanner status={status} record={dashboard} onRetry={onRetry} />
      <ConditionCard summary={summary} checkedAt={dashboard?.snapshot_at || analysis.generated_at} />
      <div className="metrics-grid">
        <Metric label="شاخص‌های اصلی قابل استفاده" value={num(summary?.checked_primary_signals, 0) + " از ۲"} hint="BGP و پایش فعال" />
        <Metric label="پوشش بازه" value={num(quality.window_coverage_percent, 1) + "٪"} hint="نمونهٔ معتبر نسبت به انتظار" />
        <Metric label="منابع دارای انحراف" value={num(analysis.anomalous_sources, 0)} hint="نیازمند شواهد مکمل" />
        <Metric label="منابع تازه" value={num(analysis.fresh_sources, 0)} hint="براساس cadence هر منبع" />
      </div>
      <Card title="یافته‌های اصلی" eyebrow="شاخص به شاخص">
        {signals.length ? <div className="finding-list">{signals.map((signal) => <article key={signal.source_id}>
          <div className="finding-heading"><strong>{safeText(signal.display_name, signal.signal)}</strong><SignalStatus value={signal.display_freshness_status || signal.freshness_status} /></div>
          <p>{signal.current_anomaly ? "تغییر غیرعادی نسبت به خط مبنا ثبت شده و نیازمند بررسی است." : signal.data_state === "usable" ? "در پنجرهٔ اخیر انحرافی بالاتر از آستانهٔ موتور تشخیص ثبت نشده است." : "دادهٔ تازه یا تاریخچهٔ کافی برای نتیجه‌گیری وجود ندارد."}</p>
          <small>مقدار: {num(signal.latest_value, 2)} · تغییر: {signal.change_percent == null ? "—" : num(signal.change_percent, 2) + "٪"} · زمان مشاهده: {formatTime(signal.last_observed_at)}</small>
        </article>)}</div> : <EmptyState title="یافته‌ای برای تحلیل موجود نیست" />}
      </Card>
      <Notice title="تفسیر درست نتیجه">یک شاخص منفرد یا شکست یک آزمون اتصال، علت فیلترینگ، تحریم یا قطعی را اثبات نمی‌کند. برای اعلام اختلال گسترده به شواهد مستقل، هم‌زمان و پایدار نیاز است.</Notice>
    </div>
  );
}

