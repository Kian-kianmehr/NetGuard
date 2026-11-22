import React, { useMemo, useState } from "react";
import { deriveDisplayNationalSummary, describeCoverage } from "../public-status.js";
import { formatFaNumber as num, formatTime, safeText, asArray } from "../lib/data.js";
import { Badge, Card, DataBanner, DataMeta, EmptyState, LoadingState, Metric, Notice, SectionIntro, SelectTabs, Table } from "../components/ui.jsx";
import { SignalChart } from "../components/charts.jsx";

import {  } from "./shared.jsx";

export function CensorshipPage({ data, status, onRetry }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const domains = asArray(data?.domains);
  const counts = useMemo(() => domains.reduce((result, row) => {
    if (row.confirmed_blocked) result.confirmed += 1;
    else if (row.has_measurements) result.anomaly += 1;
    if (row.candidate_only) result.candidate += 1;
    return result;
  }, { confirmed: 0, anomaly: 0, candidate: 0 }), [domains]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return domains.filter((row) => {
      const matches = filter === "all" ||
        (filter === "confirmed" && row.confirmed_blocked) ||
        (filter === "anomaly" && row.has_measurements && !row.confirmed_blocked) ||
        (filter === "candidate" && row.candidate_only);
      return matches && (!q || String(row.domain || "").toLowerCase().includes(q));
    }).slice(0, 500);
  }, [domains, filter, query]);
  return (
    <div className="page-stack">
      <SectionIntro eyebrow="آزمون‌های دسترسی و شواهد وب" title="وب‌سایت‌ها و فیلترینگ">
        نتایج آزمون OONI را از فهرست دامنه‌های پیشنهادی برای آزمایش جدا نگه می‌داریم.
      </SectionIntro>
      <DataBanner status={status} record={data} onRetry={onRetry} />
      <div className="metrics-grid">
        <Metric label="دامنه‌های دارای اندازه‌گیری" value={num(data?.total_domains_observed ?? counts.confirmed + counts.anomaly, 0)} hint="نتایج واقعی OONI" />
        <Metric label="مسدودسازی تأییدشده" value={num(data?.confirmed_domain_count ?? counts.confirmed, 0)} hint="براساس معیارهای OONI" tone="warning" />
        <Metric label="نشانهٔ اختلال" value={num(data?.anomaly_domain_count ?? counts.anomaly, 0)} hint="نیازمند بررسی بیشتر" />
        <Metric label="فقط نامزد آزمون" value={num(data?.candidate_domains_not_recently_tested ?? counts.candidate, 0)} hint="به‌تنهایی شاهد فیلترینگ نیست" />
      </div>
      <Notice title="فهرست پژوهشی با نتیجهٔ آزمون یکی نیست">قرار گرفتن یک دامنه در فهرست Citizen Lab به معنی فیلتر بودن آن نیست. فقط نتیجهٔ اندازه‌گیری‌شده در OONI می‌تواند شاهد باشد؛ نبود اندازه‌گیری هم به معنی دسترسی آزاد نیست.</Notice>
      <Card title="جست‌وجو در دامنه‌ها" eyebrow="داده‌های ۹۰ روز اخیر">
        <div className="filter-row">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="نام دامنه را وارد کن..." aria-label="جست‌وجوی دامنه" />
          <SelectTabs value={filter} onChange={setFilter} label="فیلتر دامنه" options={[
            { value: "all", label: "همه" }, { value: "confirmed", label: "تأییدشده" },
            { value: "anomaly", label: "نشانهٔ اختلال" }, { value: "candidate", label: "نامزد آزمون" },
          ]} />
        </div>
        <Table rows={visible} rowKey={(row) => row.domain} columns={[
          { key: "domain", label: "دامنه", render: (row) => <strong dir="ltr">{row.domain}</strong> },
          { key: "category_label", label: "دسته" },
          { key: "classification_label", label: "نتیجه", render: (row) => <Badge tone={row.confirmed_blocked ? "danger" : row.candidate_only ? "muted" : "warning"}>{row.classification_label || "نامشخص"}</Badge> },
          { key: "measurement_count", label: "آزمون", render: (row) => num(row.measurement_count, 0) },
          { key: "last_observed_at", label: "آخرین آزمون", render: (row) => formatTime(row.last_observed_at) },
          { key: "source_url", label: "منبع", render: (row) => <a href={row.source_url} target="_blank" rel="noreferrer">باز کردن ↗</a> },
        ]} emptyTitle="دامنه‌ای با این فیلتر پیدا نشد" emptyDetail="فیلتر دیگری انتخاب کن یا عبارت جست‌وجو را تغییر بده." />
      </Card>
      <div className="data-meta"><span>آخرین همگام‌سازی: {formatTime(data?.sync?.finished_at || data?.snapshot_at)}</span><span>تعداد نمایش‌داده‌شده: {num(visible.length, 0)}</span></div>
    </div>
  );
}

