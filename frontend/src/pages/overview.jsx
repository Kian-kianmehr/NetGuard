import React, { useMemo, useState } from "react";
import { deriveDisplayNationalSummary, describeCoverage } from "../public-status.js";
import { formatFaNumber as num, formatTime, safeText, asArray } from "../lib/data.js";
import { Badge, Card, DataBanner, DataMeta, EmptyState, LoadingState, Metric, Notice, SectionIntro, SelectTabs, Table } from "../components/ui.jsx";
import { SignalChart } from "../components/charts.jsx";

import { severity, SignalStatus, ConditionCard, SignalSummaryCard, buildPlainIntelligenceSummary, PlainForecastCard } from "./shared.jsx";
import { AiQuestionPanel } from "./intelligence.jsx";

export function OverviewPage({ dashboard, dashboardStatus, intelligenceRecord, intelligenceStatus, onRetry, hours, onHours, onNavigate }) {
  const analysis = dashboard?.analysis || {};
  const signals = asArray(analysis.signals);
  const sources = asArray(dashboard?.sources);
  const observations = asArray(dashboard?.observations);
  const events = asArray(dashboard?.events);
  const dataQuality = analysis.data_quality || {};
  const freshCount = signals.filter((item) => (item.display_freshness_status || item.freshness_status) === "fresh").length;
  const summary = deriveDisplayNationalSummary(analysis.public_summary, signals);
  const hoursOptions = [{ value: 24, label: "۲۴ ساعت" }, { value: 72, label: "۳ روز" }, { value: 168, label: "۷ روز" }];
  return (
    <div className="page-stack">
      <SectionIntro eyebrow="مرکز پایش ملی · ایران" title="نمای کلی اینترنت ایران">
        شاخص‌های زیرساخت، سنجش دسترسی، کیفیت داده و تحلیل هوشمند را در یک گزارش قابل بررسی کنار هم ببین.
      </SectionIntro>
      <DataBanner status={dashboardStatus} record={dashboard} onRetry={onRetry} />
      {intelligenceRecord && (() => {
        const intelligence = intelligenceRecord.intelligence || {};
        const cause = intelligence.cause_analysis || {};
        const causeIsUnclear = !cause.hypothesis_id || cause.evidence_strength === "none" || cause.hypothesis_id === "insufficient_evidence";
        const plainSummary = buildPlainIntelligenceSummary(intelligence);
        return <>
          <AiQuestionPanel
            intelligence={intelligence}
            plainSummary={plainSummary}
            models={asArray(intelligence.signals)}
            forecast={intelligence.forecast || {}}
            cause={cause}
            causeIsUnclear={causeIsUnclear}
          />
          <Card className="ai-plain-overview">
            <div className="ai-plain-heading">
              <div>
                <span className="eyebrow">برداشت مدل از وضعیت شبکه</span>
                <h2>{plainSummary.title}</h2>
                <p>{plainSummary.text}</p>
              </div>
              <Badge tone={plainSummary.tone}>{plainSummary.label}</Badge>
            </div>
          </Card>
          <PlainForecastCard forecast={intelligence.forecast || {}} />
        </>;
      })()}
      <div className="toolbar-row">
        <SelectTabs value={hours} onChange={onHours} options={hoursOptions} label="بازهٔ زمانی" />
        <span className="quiet-label">{num(observations.length, 0)} مشاهده در این بازه</span>
      </div>
      {!dashboard && dashboardStatus?.loading ? <LoadingState label="در حال دریافت Snapshot ملی..." /> : (
        <>
          <ConditionCard summary={summary} checkedAt={dashboard?.snapshot_at || dashboard?.generated_at} />
          <div className="metrics-grid">
            <Metric label="منابع تازه" value={num(freshCount, 0) + " از " + num(signals.length || sources.length, 0)} hint="براساس آستانهٔ تازگی هر منبع" icon="◉" />
            <Metric label="پوشش نمونه‌ها" value={num(dataQuality.window_coverage_percent, 1) + "٪"} hint="پوشش تاریخچه، نه پوشش جغرافیایی" icon="▦" />
            <Metric label="انحراف‌های شناسایی‌شده" value={num(analysis.anomalous_sources, 0)} hint="نیازمند بررسی با شواهد دیگر" icon="⌁" tone={analysis.anomalous_sources ? "warning" : "default"} />
            <Metric label="رخدادهای بازه" value={num(events.length, 0)} hint="رخداد و هشدار عملیاتی" icon="!" />
          </div>
          <Card title="شاخص‌های اصلی" eyebrow="نمای زنده از دادهٔ ذخیره‌شده" subtitle="هر شاخص جداگانه سنجیده می‌شود؛ اعداد با واحدهای متفاوت با هم جمع نمی‌شوند.">
            {signals.length ? <div className="signal-grid">{signals.map((signal) => <SignalSummaryCard key={signal.source_id} signal={signal} observations={observations} />)}</div> : <EmptyState title="شاخصی در Snapshot نیست" detail="دادهٔ ساختگی جایگزین نخواهد شد. زمان و وضعیت آخرین Snapshot را بررسی کن." />}
          </Card>
          <div className="two-column">
            <Card title="رخدادهای اخیر" eyebrow="دفتر رخدادها">
              {events.length ? <div className="compact-list">{events.slice(0, 5).map((event) => {
                const [label, tone] = severity[event.severity] || ["نامشخص", "muted"];
                return <div className="compact-item" key={event.event_id}><span className="compact-dot" /><div><strong>{safeText(event.title, event.event_type || "رخداد")}</strong><small>{safeText(event.source_name, "منبع نامشخص")} · {formatTime(event.occurred_at)}</small></div><Badge tone={tone}>{label}</Badge></div>;
              })}</div> : <EmptyState title="رخدادی ثبت نشده" detail="نبود رخداد، سلامت کامل شبکه را اثبات نمی‌کند." />}
              <button className="text-button" onClick={() => onNavigate("events")}>مشاهدهٔ همهٔ رخدادها ←</button>
            </Card>
            <Card title="کیفیت داده" eyebrow="پوشش و تازگی">
              <div className="quality-highlight"><strong>{num(dataQuality.window_coverage_percent, 1)}٪</strong><span>پوشش نمونه در بازه</span></div>
              <p>{describeCoverage(dataQuality).detail}</p>
              <div className="progress-track"><i style={{ width: Math.max(0, Math.min(100, Number(dataQuality.window_coverage_percent) || 0)) + "%" }} /></div>
              <button className="text-button" onClick={() => onNavigate("quality")}>جزئیات کیفیت داده ←</button>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

export function QualityPage({ dashboard, status, onRetry, hours, onHours }) {
  const analysis = dashboard?.analysis || {};
  const quality = analysis.data_quality || {};
  const sources = asArray(quality.source_details);
  return (
    <div className="page-stack">
      <SectionIntro eyebrow="اعتبار و پیوستگی اندازه‌گیری‌ها" title="کیفیت و پوشش داده">
        این صفحه نشان می‌دهد داده‌ها چقدر تازه‌اند، چه تعداد مشاهده ثبت شده و کجا بین نمونه‌ها شکاف وجود دارد.
      </SectionIntro>
      <DataBanner status={status} record={dashboard} onRetry={onRetry} />
      <SelectTabs value={hours} onChange={onHours} options={[{ value: 24, label: "۲۴ ساعت" }, { value: 72, label: "۳ روز" }, { value: 168, label: "۷ روز" }]} label="بازهٔ کیفیت" />
      {!dashboard ? <LoadingState label="در انتظار دادهٔ کیفیت..." /> : (
        <>
          <div className="metrics-grid">
            <Metric label="پوشش نمونه‌ها" value={num(quality.window_coverage_percent, 1) + "٪"} hint={quality.coverage_label || "نسبت نمونهٔ ثبت‌شده به مورد انتظار"} />
            <Metric label="طول تاریخچه" value={num(quality.observed_span_percent, 1) + "٪"} hint="از کل بازهٔ انتخابی" />
            <Metric label="نمونهٔ معتبر" value={num(quality.valid_observations, 0)} hint={"از " + num(quality.expected_observations, 0) + " نمونهٔ مورد انتظار"} />
            <Metric label="منابع دارای شکاف" value={num(quality.sources_with_gaps, 0)} hint={"از " + num(quality.sources_total, 0) + " منبع"} />
          </div>
          <Notice title="پوشش داده با سلامت شبکه یکی نیست">درصد پوشش فقط سهم اندازه‌گیری‌های معتبر از تعداد مورد انتظار است. دادهٔ گم‌شده صفر نیست و نباید به‌عنوان اتصال سالم تفسیر شود.</Notice>
          <Card title="کیفیت به تفکیک منبع" eyebrow="تازگی و cadence">
            <Table rows={sources} rowKey={(row) => row.source_id} columns={[
              { key: "display_name", label: "شاخص", render: (row) => <strong>{safeText(row.display_name, row.signal)}</strong> },
              { key: "freshness_status", label: "تازگی", render: (row) => <SignalStatus value={row.display_freshness_status || row.freshness_status} /> },
              { key: "sample_coverage_percent", label: "پوشش نمونه", render: (row) => num(row.sample_coverage_percent, 1) + "٪" },
              { key: "valid_observations", label: "نمونهٔ معتبر", render: (row) => num(row.valid_observations, 0) },
              { key: "expected_interval_seconds", label: "فاصلهٔ معمول", render: (row) => num((row.expected_interval_seconds || 0) / 60, 0) + " دقیقه" },
              { key: "last_observed_at", label: "آخرین مشاهده", render: (row) => formatTime(row.last_observed_at) },
            ]} emptyTitle="جزئیات کیفیت منبع موجود نیست" />
          </Card>
          <Card title="سلامت هر منبع" eyebrow="وضعیت آخرین مشاهده">
            <Table rows={asArray(dashboard.sources)} rowKey={(row) => row.source_id} columns={[
              { key: "display_name", label: "منبع", render: (row) => safeText(row.display_name, row.source_id) },
              { key: "provider", label: "ارائه‌دهنده" },
              { key: "freshness_status", label: "وضعیت", render: (row) => <SignalStatus value={row.freshness_status} /> },
              { key: "last_observed_at", label: "مشاهده", render: (row) => formatTime(row.last_observed_at) },
            ]} />
          </Card>
        </>
      )}
    </div>
  );
}

