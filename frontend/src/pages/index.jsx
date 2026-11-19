import React, { useMemo, useState } from "react";
import { deriveDisplayNationalSummary, describeCoverage } from "../public-status.js";
import { formatFaNumber as num, formatTime, safeText, asArray } from "../lib/data.js";
import { Badge, Card, DataBanner, DataMeta, EmptyState, LoadingState, Metric, Notice, SectionIntro, SelectTabs, Table } from "../components/ui.jsx";
import { SignalChart } from "../components/charts.jsx";

const primaryNames = { bgp: "دیدپذیری مسیرهای اینترنت (BGP)", "ping-slash24": "پایش فعال شبکه", "merit-nt": "تلسکوپ شبکه (Merit)" };
const severity = {
  critical: ["بحرانی", "danger"], high: ["زیاد", "danger"],
  warning: ["هشدار", "warning"], info: ["اطلاع", "muted"],
};
const freshness = {
  fresh: ["تازه", "good"], delayed: ["با تأخیر", "warning"],
  stale: ["قدیمی", "warning"], degraded: ["دارای خطا", "danger"],
  unknown: ["نامشخص", "muted"],
};
const providerStatus = {
  operational: ["عادی", "good"], degraded_performance: ["افت عملکرد", "warning"],
  partial_outage: ["اختلال بخشی", "danger"], major_outage: ["اختلال گسترده", "danger"],
  under_maintenance: ["تعمیر و نگهداری", "warning"], unknown: ["نامشخص", "muted"],
};

function toneForCondition(condition) {
  if (condition === "possible_disruption" || condition === "elevated_attention") return "danger";
  if (condition === "attention" || condition === "watch") return "warning";
  if (condition === "stable" || condition === "stable_limited" || condition === "no_anomaly_detected") return "good";
  return "muted";
}

function SignalStatus({ value }) {
  const [label, tone] = freshness[value] || freshness.unknown;
  return <Badge tone={tone}>{label}</Badge>;
}

function ConditionCard({ summary, checkedAt }) {
  if (!summary) return (
    <Card className="condition-card">
      <span className="eyebrow">وضعیت ملی اینترنت</span>
      <h2>دادهٔ کافی برای ارزیابی نداریم</h2>
      <p>تا رسیدن دادهٔ تازه، وضعیت را نه پایدار و نه مختل اعلام می‌کنیم.</p>
    </Card>
  );
  const tone = toneForCondition(summary.condition);
  return (
    <Card className={"condition-card condition-" + tone}>
      <div className="condition-head">
        <div>
          <span className="eyebrow">جمع‌بندی شاخص‌های ملی</span>
          <h2>{safeText(summary.title, "وضعیت نامشخص")}</h2>
          <p>{safeText(summary.summary, "جمع‌بندی متنی برای این Snapshot موجود نیست.")}</p>
        </div>
        <Badge tone={tone}>{safeText(summary.condition_label, "نامشخص")}</Badge>
      </div>
      <div className="condition-details">
        <div><small>شواهد اختلال گسترده</small><b>{safeText(summary.outage_label, "نامشخص")}</b></div>
        <div><small>پایداری زیرساخت</small><b>{safeText(summary.stability_label, "نامشخص")}</b></div>
        <div><small>روند اخیر</small><b>{safeText(summary.trend_label, "نامشخص")}</b></div>
        <div><small>اطمینان</small><b>{safeText(summary.confidence_label, "نامشخص")}</b></div>
      </div>
      {summary.reasoning?.length > 0 && (
        <div className="evidence-list"><strong>مبنای این ارزیابی</strong><ul>{summary.reasoning.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
      )}
      <p className="scope-note">{summary.scope_note || "ارزیابی ملی است و تجربهٔ یکسان همهٔ کاربران یا وضعیت هر اپراتور را ثابت نمی‌کند."}</p>
      <DataMeta record={{ snapshot_at: checkedAt }} />
    </Card>
  );
}

function SignalSummaryCard({ signal, observations }) {
  const rows = observations.filter((row) => row.source_id === signal.source_id);
  const change = Number(signal.change_percent);
  return (
    <Card className="signal-summary">
      <div className="signal-card-top">
        <div><span className="eyebrow">{safeText(signal.provider, "منبع")}</span><h3>{safeText(signal.display_name, primaryNames[signal.signal] || signal.signal)}</h3></div>
        <SignalStatus value={signal.display_freshness_status || signal.freshness_status} />
      </div>
      <p>{safeText(signal.plain_explanation, signal.description || "توضیح این شاخص در دادهٔ فعلی موجود نیست.")}</p>
      <div className="signal-values">
        <div><small>آخرین مقدار</small><b>{num(signal.latest_value, 2)}</b><em>{signal.unit || ""}</em></div>
        <div><small>خط مبنا</small><b>{num(signal.baseline_value, 2)}</b><em>میانهٔ پنجره</em></div>
        <div><small>تغییر اخیر</small><b className={Number.isFinite(change) && change < 0 ? "negative" : "positive"}>{Number.isFinite(change) ? (change > 0 ? "+" : "") + num(change, 2) + "٪" : "—"}</b><em>{signal.current_anomaly ? "انحراف ثبت شده" : "نسبت به خط مبنا"}</em></div>
      </div>
      <SignalChart rows={rows} />
      <div className="signal-card-foot"><span>{num(signal.sample_count, 0)} نمونه</span><span>آخرین مشاهده: {formatTime(signal.last_observed_at)}</span></div>
    </Card>
  );
}

function AiBrief({ intelligence }) {
  const brief = intelligence?.analysis_brief;
  if (!brief) return <EmptyState title="جمع‌بندی هوش مصنوعی آماده نیست" detail="مدل تا زمان دسترسی به تاریخچه و دادهٔ معتبر، نتیجهٔ ساختگی نمایش نمی‌دهد." />;
  const tone = brief.status === "alert" ? "danger" : brief.status === "normal" ? "good" : "warning";
  return (
    <Card className={"ai-brief ai-brief-" + tone} title={brief.headline || "گزارش هوشمند نت‌گارد"} eyebrow="برداشت تحلیلی از داده‌های پایش" subtitle={brief.summary}>
      <div className="ai-brief-meta"><Badge tone={tone}>{brief.confidence_label || "اطمینان نامشخص"}</Badge><span>{brief.generated_at ? formatTime(brief.generated_at) : "زمان تولید نامشخص"}</span></div>
      {brief.evidence?.length > 0 && <div className="evidence-list"><strong>شواهد</strong><ul>{brief.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      {brief.limitations?.length > 0 && <div className="evidence-list"><strong>محدودیت‌ها</strong><ul>{brief.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    </Card>
  );
}

function OverviewPage({ dashboard, dashboardStatus, onRetry, hours, onHours, onNavigate }) {
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
          <AiBrief intelligence={analysis.intelligence} />
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

function QualityPage({ dashboard, status, onRetry, hours, onHours }) {
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

function CensorshipPage({ data, status, onRetry }) {
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

function ProvidersPage({ providersData, datacenters, providerStatus, datacenterStatus, onRetryProviders, onRetryDatacenters }) {
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

function ProviderCard({ item }) {
  const [label, tone] = providerStatus[item.status] || providerStatus.unknown;
  return (
    <article className="provider-card">
      <div className="provider-card-top"><div><strong>{safeText(item.name, item.id)}</strong><small>{item.group === "ai" ? "هوش مصنوعی" : item.group === "developer" ? "توسعه‌دهنده" : "زیرساخت"}</small></div><Badge tone={tone}>{item.status_label || label}</Badge></div>
      <p>{safeText(item.description, "توضیحی از این سرویس موجود نیست.")}</p>
      {item.affected_locations?.length > 0 && <small>{num(item.affected_locations.length, 0)} مؤلفهٔ مکان‌محور نیازمند توجه</small>}
      <a href={item.url} target="_blank" rel="noreferrer">صفحهٔ رسمی وضعیت ↗</a>
    </article>
  );
}

function IntelligencePage({ dashboard, status, onRetry }) {
  const analysis = dashboard?.analysis || {};
  const intelligence = analysis.intelligence || {};
  const forecast = intelligence.forecast || {};
  const components = asArray(forecast.components).filter((item) => item.available);
  const models = asArray(intelligence.signals);
  const cause = intelligence.cause_analysis || {};
  const recovery = intelligence.recovery_estimate || {};
  const primarySignals = ["bgp", "ping-slash24"];
  const primaryComponents = components.filter((item) => primarySignals.includes(item.signal));
  const stalePrimary = models.filter((item) => primarySignals.includes(item.signal) && item.status === "stale_data");
  const anomalous = models.filter((item) => item.is_anomaly);
  const projection30 = (item) => asArray(item.horizon_projections).find((point) => point.minutes === 30);
  const formatTrend = (item) => {
    const point = projection30(item);
    if (!point || point.projected_change_percent == null) return "روند ۳۰ دقیقه‌ای قابل محاسبه نیست.";
    const change = Number(point.projected_change_percent);
    if (Math.abs(change) < 0.01) return "تقریبا بدون تغییر";
    return (change > 0 ? "افزایش حدود " : "کاهش حدود ") + num(Math.abs(change), 2) + "٪";
  };
  let outlookTitle = "فعلا نمی‌توان درباره وضعیت کلی اینترنت پیش‌بینی قابل اتکایی داد";
  let outlookText = forecast.note || "برای پیش‌بینی وضعیت کلی، دادهٔ تازه از هر دو شاخص اصلی لازم است.";
  if (primaryComponents.length === 2 && forecast.available) {
    const score = Number(forecast.risk_index);
    if (Number.isFinite(score) && score >= 60) {
      outlookTitle = "نشانه‌های افت در داده‌های اصلی بیشتر شده‌اند";
      outlookText = "هر دو شاخص اصلی برای ۳۰ دقیقهٔ آینده برآورد دارند و ترکیب آن‌ها نیاز به توجه بیشتر را نشان می‌دهد. بهتر است وضعیت در به‌روزرسانی بعدی دوباره بررسی شود؛ این نتیجه به معنی قطعی اینترنت نیست.";
    } else if (Number.isFinite(score) && score >= 30) {
      outlookTitle = "احتمال تغییر در وضعیت شبکه نیازمند پیگیری است";
      outlookText = "داده‌های دو شاخص اصلی نشانه‌هایی برای بررسی بیشتر دارند، اما شواهد فعلی برای اعلام اختلال گسترده کافی نیست.";
    } else {
      outlookTitle = "فعلا نشانهٔ قوی از افت در شاخص‌های اصلی دیده نمی‌شود";
      outlookText = "برآورد دو شاخص اصلی در حال حاضر نشانهٔ پرقدرتی از افت نشان نمی‌دهد. این نتیجه تضمین نمی‌کند که در همه نقاط کشور اتصال بدون مشکل باشد.";
    }
  } else if (primaryComponents.length === 1) {
    const item = primaryComponents[0];
    const name = primaryNames[item.signal] || item.signal;
    outlookTitle = "فقط برای بخشی از شبکه می‌توان روند کوتاه‌مدت گفت";
    outlookText = "برای «" + name + "» مدل در ۳۰ دقیقهٔ آینده " + formatTrend(item) + " را برآورد کرده است. این پیش‌بینی فقط درباره همین شاخص است، نه وضعیت کل اینترنت. " +
      (stalePrimary.length ? "دادهٔ " + stalePrimary.map((entry) => primaryNames[entry.signal] || entry.display_name).join(" و ") + " تازه نیست؛ بنابراین هنوز نمی‌توان درباره افت یا پایداری سراسری نتیجه گرفت." : "برای نتیجه‌گیری ملی، دادهٔ هم‌زمان از شاخص اصلی دیگر هم لازم است.");
  } else if (components.length) {
    outlookText = "مدل برای بعضی منابع روند کوتاه‌مدت محاسبه کرده، اما شاخص‌های اصلی برای جمع‌بندی وضعیت کلی اینترنت کافی نیستند.";
  }
  if (anomalous.length && primaryComponents.length < 2) {
    outlookText += " در " + anomalous.map((item) => item.display_name).join(" و ") + " تغییر غیرمعمولی دیده شده؛ این هشدار به‌تنهایی به معنی اختلال اینترنت نیست.";
  }
  return (
    <div className="page-stack">
      <SectionIntro eyebrow="NetGuard Intelligence" title="هوش مصنوعی و پیش‌بینی">
        این بخش بررسی می‌کند در نیم ساعت آینده چه روندی برای اینترنت قابل انتظار است. اگر داده‌های مهم به‌روز نباشند، به‌جای حدس زدن نتیجه را نامشخص اعلام می‌کنیم.
      </SectionIntro>
      <DataBanner status={status} record={dashboard} onRetry={onRetry} />
      <div className="metrics-grid">
        <Metric label="وضعیت پیش‌بینی" value={primaryComponents.length === 2 && forecast.available ? "قابل ارائه" : primaryComponents.length ? "محدود" : "نامشخص"} hint={primaryComponents.length === 2 && forecast.available ? "هر دو شاخص اصلی دادهٔ کافی دارند" : "برای پیش‌بینی وضعیت کلی، دادهٔ تازه و هم‌زمان لازم است"} />
        <Metric label="نشانه‌های افت" value={forecast.risk_index == null ? "نامشخص" : num(forecast.risk_index, 0) + " از ۱۰۰"} hint={forecast.risk_index == null ? "این خط تیره یا وضعیت نامشخص، صفر نیست؛ امتیاز محاسبه نشده است." : "امتیاز بررسی است، نه درصد احتمال قطعی"} tone={forecast.available ? "warning" : "default"} />
        <Metric label="شاخص‌های دارای دادهٔ کافی" value={num(intelligence.trained_signals, 0)} hint={"از " + num(models.length, 0) + " شاخص"} />
        <Metric label="بررسی هم‌زمان شاخص‌ها" value={intelligence.joint_model?.score == null ? "نامشخص" : intelligence.joint_model.is_anomaly ? "نیازمند توجه" : "نشانهٔ غیرعادی دیده نشد"} hint={intelligence.joint_model?.status_label || "دادهٔ تازهٔ شاخص‌های اصلی لازم است"} />
      </div>
      <AiBrief intelligence={intelligence} />
      <Card title="در ۳۰ دقیقهٔ آینده چه انتظاری داریم؟" eyebrow="جمع‌بندی سادهٔ پیش‌بینی">
        <div className="risk-callout">
          <strong>{outlookTitle}</strong>
          <p>{outlookText}</p>
        </div>
        {components.length ? <div className="forecast-grid">{components.map((item) => {
          const point = projection30(item);
          return <article className="forecast-card" key={item.signal}>
            <span className="eyebrow">{primaryNames[item.signal] || item.signal}</span>
            <h3>مقدار فعلی: {num(item.current_value, 2)}</h3>
            <div className="forecast-points">
              <div><small>برآورد ۳۰ دقیقهٔ آینده</small><b>{point ? num(point.projected_value, 2) : "—"}</b><span>{formatTrend(item)}</span></div>
            </div>
            <p>این عدد روند همین شاخص را نشان می‌دهد؛ به‌تنهایی پیش‌بینی قطعی یا احتمال اختلال نیست.</p>
          </article>;
        })}</div> : <EmptyState title="فعلا پیش‌بینی قابل ارائه نیست" detail={forecast.note || "وقتی دادهٔ تازه و تاریخچهٔ کافی برسد، برآورد نمایش داده می‌شود."} />}
      </Card>
      <Card title="چه تغییرهایی در شاخص‌ها دیده شده؟" eyebrow="بررسی جداگانهٔ منابع">
        {models.length ? <div className="model-list">{models.map((item) => {
          const description = item.is_anomaly
            ? "رفتار اخیر این شاخص با الگوی معمول گذشته تفاوت داشته است. این یک نشانه برای بررسی است و به‌تنهایی اختلال اینترنت را ثابت نمی‌کند."
            : item.status === "stale_data"
              ? "اطلاعات این منبع به‌روز نیست؛ بنابراین فعلا نمی‌توان از آن درباره وضعیت فعلی نتیجه گرفت."
              : item.status === "ready"
                ? "رفتار فعلی این شاخص به الگوی معمول گذشته نزدیک است."
                : "هنوز دادهٔ کافی برای بررسی این شاخص جمع نشده است.";
          return <article className="model-row" key={item.source_id}>
            <div><strong>{safeText(item.display_name, item.signal)}</strong><Badge tone={item.is_anomaly ? "warning" : item.status === "ready" ? "good" : "muted"}>{item.is_anomaly ? "تغییر غیرمعمول" : item.status === "stale_data" ? "داده قدیمی" : item.status === "ready" ? "نزدیک به حالت معمول" : "دادهٔ ناکافی"}</Badge></div>
            <p>{description}</p>
            <small>آخرین داده: {item.observation_age_seconds == null ? "نامشخص" : num(item.observation_age_seconds / 60, 0) + " دقیقه قبل"}{item.score == null ? "" : " · امتیاز بررسی: " + num(item.score * 100, 0) + " از ۱۰۰"}</small>
          </article>;
        })}</div> : <EmptyState title="هنوز داده‌ای برای بررسی وجود ندارد" />}
        <p className="scope-note">امتیاز بررسی، احتمال قطعی نیست. قدیمی بودن داده هم به معنی سالم یا مختل بودن شبکه نیست.</p>
      </Card>
      <Card title="آیا علت تغییر مشخص است؟" eyebrow="بررسی شواهد">
        <h3>{cause.hypothesis_label || "هنوز علت مشخصی پیدا نشده است"}</h3>
        <p>{cause.description || cause.scope_note || "برای مشخص شدن علت، چند منبع مستقل باید تغییر مشابهی را در یک زمان نشان دهند."}</p>
        {cause.alternative_explanations?.length > 0 && <ul className="simple-list">{cause.alternative_explanations.map((item, index) => <li key={index}>{item}</li>)}</ul>}
      </Card>
      <Card title="چه زمانی وضعیت به حالت عادی برمی‌گردد؟" eyebrow="زمان بازیابی">
        <EmptyState title="فعلا زمان بازیابی مشخص نیست" detail="برای تخمین زمان پایان یک اختلال، باید نمونه‌های کافی از رخدادهای قبلی و زمان پایان آن‌ها داشته باشیم. در حال حاضر چنین اطلاعاتی کافی نیست." />
      </Card>
    </div>
  );
}

function AnalysisPage({ dashboard, status, onRetry }) {
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

function SignalsPage({ dashboard, status, onRetry, hours, onHours }) {
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

function EventsPage({ dashboard, status, onRetry }) {
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

function SourcesPage({ dashboard, status, onRetry }) {
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

function MethodPage() {
  return (
    <div className="page-stack">
      <SectionIntro eyebrow="روش‌شناسی و محدودیت‌ها" title="نت‌گارد چگونه نتیجه می‌گیرد؟">
        هر نتیجه باید قابل ردیابی به منبع، زمان، کیفیت نمونه و محدودیت اندازه‌گیری باشد.
      </SectionIntro>
      <div className="method-grid">
        <article><span>۰۱</span><h3>دریافت شواهد</h3><p>Collectorهای زمان‌بندی‌شده داده‌های IODA، آزمون‌های OONI و صفحه‌های رسمی وضعیت سرویس‌ها را ذخیره می‌کنند.</p></article>
        <article><span>۰۲</span><h3>کنترل کیفیت</h3><p>زمان مشاهده، زمان دریافت، cadence، نمونه‌های نامعتبر و شکاف داده جداگانه بررسی می‌شوند.</p></article>
        <article><span>۰۳</span><h3>تحلیل و مدل</h3><p>خط مبنا و ناهنجاری هر شاخص مستقل محاسبه می‌شود؛ پیش‌بینی فقط با تاریخچهٔ کافی و ارزیابی زمانی منتشر می‌شود.</p></article>
        <article><span>۰۴</span><h3>جمع‌بندی محتاطانه</h3><p>وضعیت ملی از کنار هم گذاشتن شاخص‌های اصلی به دست می‌آید. یک مشاهدهٔ منفرد، علت اختلال را مشخص نمی‌کند.</p></article>
      </div>
      <Card title="قواعد تفسیر" eyebrow="اصول ثابت">
        <ul className="simple-list">
          <li>دادهٔ گم‌شده صفر نیست و نشانهٔ سلامت شبکه محسوب نمی‌شود.</li>
          <li>زمان مشاهده با زمان جمع‌آوری یکی نیست؛ هر دو باید حفظ شوند.</li>
          <li>دادهٔ ملی به استان، شهر یا اپراتور تعمیم داده نمی‌شود.</li>
          <li>یک خطای اتصال یا کاهش یک شاخص، علت فیلترینگ، تحریم یا خاموشی را ثابت نمی‌کند.</li>
          <li>عددهای شاخص‌هایی با واحد متفاوت با هم جمع یا مقایسه نمی‌شوند.</li>
          <li>امتیاز ناهنجاری و ریسک، احتمال کالیبره‌شدهٔ اختلال نیست.</li>
          <li>فهرست Citizen Lab فقط نامزد آزمون است؛ نتیجهٔ OONI جداگانه ارزیابی می‌شود.</li>
          <li>وضعیت جهانی سرویس‌ها، دسترسی کاربران ایران به آن‌ها را اثبات نمی‌کند.</li>
          <li>موجودی دیتاسنترها وضعیت روشن/خاموش یا سلامت عملیاتی آن‌ها را نشان نمی‌دهد.</li>
        </ul>
      </Card>
      <Notice title="محدودیت جغرافیایی">نسخهٔ فعلی پایش ملی دارد، نه probe مستقل در تمام استان‌ها و اپراتورها. به همین دلیل نقشهٔ استانی و رتبه‌بندی ISP از این داده‌ها قابل استنتاج نیست.</Notice>
    </div>
  );
}

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
