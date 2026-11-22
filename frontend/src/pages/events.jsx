import React, { useMemo, useState } from "react";
import { deriveDisplayNationalSummary, describeCoverage } from "../public-status.js";
import { formatFaNumber as num, formatTime, safeText, asArray } from "../lib/data.js";
import { Badge, Card, DataBanner, DataMeta, EmptyState, LoadingState, Metric, Notice, SectionIntro, SelectTabs, Table } from "../components/ui.jsx";
import { SignalChart } from "../components/charts.jsx";

import * as shared from "./shared.jsx";

const { primaryNames, severity, freshness, providerStatus, toneForCondition, SignalStatus, ConditionCard, SignalSummaryCard, AiBrief, ProviderCard, friendlySignalName, observationAgeText, explainSignalInPlainLanguage, buildPlainIntelligenceSummary, forecastChangeText, forecastPlainDescription, PlainForecastCard } = shared;

export function EventsPage({ dashboard, status, onRetry }) {
  const [filter, setFilter] = useState("all");
  const [type, setType] = useState("all");
  const events = asArray(dashboard?.events);
  const visible = events.filter((event) => (filter === "all" || event.severity === filter) && (type === "all" || event.lifecycle === type));
  return (
    <div className="page-stack">
      <SectionIntro eyebrow="تاریخچه و پیگیری" title="دفتر رخدادها">
        رخداد آماری، تأخیر منبع و خطای جمع‌آوری جدا نمایش داده می‌شوند؛ هشدار عملیاتی به معنی اختلال شبکه نیست.
      </SectionIntro>
      <DataBanner status={status} record={dashboard} onRetry={onRetry} />
      <div className="toolbar-row wrap">
        <SelectTabs value={filter} onChange={setFilter} label="شدت رخداد" options={[
          { value: "all", label: "همه شدت‌ها" }, { value: "critical", label: "بحرانی" },
          { value: "high", label: "زیاد" }, { value: "warning", label: "هشدار" }, { value: "info", label: "اطلاع" },
        ]} />
        <SelectTabs value={type} onChange={setType} label="چرخهٔ رخداد" options={[
          { value: "all", label: "همه وضعیت‌ها" }, { value: "active", label: "در جریان" }, { value: "resolved", label: "پایان‌یافته" },
        ]} />
      </div>
      {visible.length ? <div className="event-list">{visible.map((event) => {
        const [label, tone] = severity[event.severity] || ["نامشخص", "muted"];
        return <article className="event-card" key={event.event_id}>
          <div className="event-heading"><div><span className="eyebrow">{event.event_type || "رخداد"}</span><h3>{safeText(event.title, "رخداد ثبت‌شده")}</h3></div><Badge tone={tone}>{label}</Badge></div>
          <p>{safeText(event.description, event.explanation || "شرح تکمیلی موجود نیست.")}</p>
          <div className="event-meta"><span>{safeText(event.source_name, "منبع نامشخص")}</span><span>شروع: {formatTime(event.occurred_at || event.started_at)}</span><span>{event.lifecycle === "active" ? "در جریان" : event.lifecycle === "resolved" ? "پایان‌یافته" : "تاریخی"}</span></div>
        </article>;
      })}</div> : <EmptyState title={events.length ? "رخدادی با این فیلتر وجود ندارد" : "رخداد معناداری ثبت نشده"} detail="نبود رخداد، سلامت کامل اینترنت را اثبات نمی‌کند؛ پوشش اندازه‌گیری محدود است." />}
    </div>
  );
}

