import React, { useMemo, useState } from "react";
import { deriveDisplayNationalSummary, describeCoverage } from "../public-status.js";
import { formatFaNumber as num, formatTime, safeText, asArray } from "../lib/data.js";
import { Badge, Card, DataBanner, DataMeta, EmptyState, LoadingState, Metric, Notice, SectionIntro, SelectTabs, Table } from "../components/ui.jsx";
import { SignalChart } from "../components/charts.jsx";

import { providerStatus, ProviderCard } from "./shared.jsx";

export function ProvidersPage({ providersData, datacenters, providerStatus, datacenterStatus, onRetryProviders, onRetryDatacenters }) {
  const providers = asArray(providersData?.providers);
  const infrastructure = providers.filter((item) => item.group === "infrastructure");
  const developer = providers.filter((item) => item.group === "developer");
  const ai = providers.filter((item) => item.group === "ai");
  const cloudflare = providers.find((item) => item.id === "cloudflare");
  const globalNodes = asArray(cloudflare?.technical_components).filter((item) => item.name && item.name.includes(" - ("));
  const sites = asArray(datacenters?.sites);
  return (
    <div className="page-stack">
      <SectionIntro eyebrow="زیرساخت و نقاط حضور" title="دیتاسنترهای ایران و وضعیت جهانی">
        موجودی مراکز داخل ایران را از وضعیت اعلام‌شدهٔ شرکت‌های جهانی جدا می‌کنیم.
      </SectionIntro>
      <DataBanner status={providerStatus} record={providersData} onRetry={onRetryProviders} />
      <DataBanner status={datacenterStatus} record={datacenters} onRetry={onRetryDatacenters} />
      <div className="metrics-grid">
        <Metric label="مراکز ثبت‌شده در ایران" value={num(datacenters?.total_sites, 0)} hint="رکوردهای عمومی با اعتبار متفاوت" />
        <Metric label="دارای پایش مستقیم" value={num(datacenters?.directly_monitored, 0)} hint="اندازه‌گیری مستقل نت‌گارد" />
        <Metric label="ارائه‌دهندگان بررسی‌شده" value={num(providers.length, 0)} hint="صفحه‌های رسمی وضعیت" />
        <Metric label="نقاط حضور جهانی" value={num(cloudflare?.data_center_count, 0)} hint="آمار اعلام‌شده توسط Cloudflare" />
      </div>
      <Card title="مراکز داده و محل‌های میزبانی ایران" eyebrow="فهرست موجودی" subtitle={datacenters?.scope_note || "این فهرست پایش عملیاتی زنده نیست."}>
        <Table rows={sites} rowKey={(row) => row.site_id} columns={[
          { key: "name", label: "مرکز / محل", render: (row) => <><strong>{row.name}</strong><small className="table-sub">{row.notes}</small></> },
          { key: "operator", label: "اپراتور" },
          { key: "city", label: "شهر", render: (row) => [row.city, row.province].filter(Boolean).join("، ") || "نامشخص" },
          { key: "evidence_level", label: "سطح شواهد", render: (row) => ({ operator_documented: "مستند اپراتور", operator_listed: "فهرست اپراتور", third_party_listed: "منبع مستقل", directory_candidate: "نامزد دایرکتوری" })[row.evidence_level] || "نامشخص" },
          { key: "status_label", label: "وضعیت عملیاتی", render: (row) => <Badge tone="muted">{row.status_label || "پایش زنده نیست"}</Badge> },
          { key: "source_url", label: "منبع", render: (row) => <a href={row.source_url} target="_blank" rel="noreferrer">{row.source_name || "منبع"} ↗</a> },
        ]} emptyTitle="موجودی دیتاسنترها در دسترس نیست" />
      </Card>
      <Notice title="موجودی دیتاسنتر به معنی سلامت عملیاتی نیست">بدون probe مستقل از داخل ایران یا چند نقطهٔ مستقل، وضعیت هر مرکز را «نامشخص» نگه می‌داریم. از وجود نام یک مرکز نمی‌توان روشن یا خاموش بودن آن را نتیجه گرفت.</Notice>
      <Card title="زیرساخت بین‌المللی" eyebrow="وضعیت رسمی سرویس‌ها">
        <div className="provider-grid">{infrastructure.map((item) => <ProviderCard key={item.id} item={item} />)}</div>
      </Card>
      <Card title="ابزارهای توسعه و همکاری" eyebrow="وضعیت جهانی">
        <div className="provider-grid">{developer.map((item) => <ProviderCard key={item.id} item={item} />)}</div>
      </Card>
      <Card title="سرویس‌های هوش مصنوعی" eyebrow="وضعیت جهانی">
        <div className="provider-grid">{ai.map((item) => <ProviderCard key={item.id} item={item} />)}</div>
      </Card>
      <Card title="نقاط حضور اعلام‌شدهٔ Cloudflare" eyebrow="اجزای مکان‌محور">
        <Table rows={globalNodes.slice(0, 100)} rowKey={(row) => row.name} columns={[
          { key: "name", label: "شهر / نقطه حضور" },
          { key: "status", label: "وضعیت", render: (row) => <Badge tone={row.status === "operational" ? "good" : row.status === "unknown" ? "muted" : "warning"}>{row.status_label || row.status}</Badge> },
          { key: "updated_at", label: "به‌روزرسانی", render: (row) => formatTime(row.updated_at) },
        ]} emptyTitle="فهرست مکان‌های جهانی موجود نیست" />
      </Card>
      <p className="scope-note">سلامت جهانی ارائه‌دهنده، دسترسی کاربران داخل ایران به همان سرویس را ثابت نمی‌کند.</p>
    </div>
  );
}

