import { describeCoverage, deriveDisplayNationalSummary, deriveLimitedNationalVerdict } from "./public-status.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDownRight, BookOpen, BrainCircuit, CheckCircle2, CircleHelp,
  Clock3, Database, Gauge, Globe2, Info, Network, RadioTower, RefreshCw, ShieldAlert,
  ShieldCheck, Signal, TrendingDown, TrendingUp, Server, Cloud
} from "lucide-react";

const NAV = [
  ["overview", "نمای کلی", Globe2],
  ["quality", "کیفیت و پوشش داده", Database],
  ["censorship", "سایت‌ها و فیلترینگ", ShieldAlert],
  ["providers", "دیتاسنترهای ایران و جهان", Server],
  ["intelligence", "هوش مصنوعی و پیش‌بینی", BrainCircuit],
  ["analysis", "تحلیل وضعیت", Activity],
  ["signals", "سیگنال‌ها", Signal],
  ["events", "رخدادها", AlertTriangle],
  ["sources", "منابع داده", Database],
  ["method", "روش‌شناسی", BookOpen],
];
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const SNAPSHOT_CACHE_KEY = "netguard.public-snapshots.v1";
const SNAPSHOT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_STALE_AFTER = {
  dashboard_24: 900,
  dashboard_72: 900,
  dashboard_168: 900,
  censorship: 1800,
  providers_status: 900,
  iran_datacenters: 1800,
};
const SNAPSHOT_KEYS = Object.keys(SNAPSHOT_STALE_AFTER);

function readCachedSnapshotRows() {
  try {
    const cached = JSON.parse(localStorage.getItem(SNAPSHOT_CACHE_KEY) || "null");
    if (!cached || cached.version !== 1 || !Array.isArray(cached.rows)) return [];
    const savedAt = Number(cached.savedAt);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > SNAPSHOT_CACHE_MAX_AGE_MS) return [];
    return cached.rows.filter((row) =>
      row && SNAPSHOT_KEYS.includes(row.dataset_key) &&
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    );
  } catch {
    return [];
  }
}

function indexSnapshotRows(rows) {
  const indexed = {};
  for (const row of rows) {
    if (!row || !SNAPSHOT_STALE_AFTER[row.dataset_key]) continue;
    const collectedAt = row.collected_at || null;
    const collectedMs = collectedAt ? new Date(collectedAt).getTime() : NaN;
    const staleAfterSeconds = SNAPSHOT_STALE_AFTER[row.dataset_key];
    const isStale = !Number.isFinite(collectedMs) ||
      Date.now() - collectedMs > staleAfterSeconds * 1000;
    const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? row.payload
      : {};
    indexed[row.dataset_key] = {
      ...payload,
      snapshot_at: collectedAt,
      checked_at: payload.checked_at || collectedAt,
      snapshot_status: row.status || "unknown",
      source_count: row.source_count ?? 0,
      snapshot_error: row.error_code || null,
      stale_after_seconds: staleAfterSeconds,
      is_stale: isStale,
    };
  }
  return indexed;
}
const number = (value, digits = 1) => value == null || !Number.isFinite(Number(value))
  ? "—"
  : new Intl.NumberFormat("fa-IR", { maximumFractionDigits: digits }).format(Number(value));
const time = (value, withDate = true) => {
  if (!value) return "نامشخص";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "نامشخص";
  return new Intl.DateTimeFormat("fa-IR", {
    timeZone: "Asia/Tehran",
    ...(withDate ? { month: "short", day: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};
const freshness = {
  fresh: ["تازه", "good"], delayed: ["با تأخیر", "warn"], stale: ["قدیمی", "warn"],
  degraded: ["دارای خطا", "danger"], unknown: ["نامشخص", "neutral"],
};
const assessmentTone = {
  elevated_attention: "danger", watch: "warn",
  no_anomaly_detected: "good", insufficient_data: "neutral",
};
const assessmentIcon = {
  elevated_attention: ShieldAlert, watch: AlertTriangle,
  no_anomaly_detected: ShieldCheck, insufficient_data: CircleHelp,
};
const eventSeverity = {
  critical: ["بحرانی", "danger"], high: ["زیاد", "danger"],
  warning: ["هشدار", "warn"], info: ["اطلاع", "neutral"],
};
const eventTypeLabel = {
  signal_anomaly: "انحراف آماری سیگنال",
  source_delayed: "تأخیر در مشاهدهٔ منبع",
  source_stale: "هشدار تازگی داده",
  collector_error: "هشدار اجرای جمع‌آوری",
};

function Badge({ value, map = freshness }) {
  const [label, tone] = map[value] || ["نامشخص", "neutral"];
  return <span className={"badge " + tone}><i />{label}</span>;
}
function Panel({ tag, title, note, action, children, className = "" }) {
  return <section className={"panel " + className}>
    <header className="panel-head">
      <div><small>{tag}</small><h2>{title}</h2>{note && <p>{note}</p>}</div>
      {action}
    </header>
    {children}
  </section>;
}
function Empty({ title = "داده‌ای برای نمایش نیست", note = "پس از دریافت دادهٔ معتبر، نتیجه در این بخش نشان داده می‌شود." }) {
  return <div className="empty"><span>∅</span><strong>{title}</strong><p>{note}</p></div>;
}
function Stat({ icon: Icon = Activity, label, value, hint, tone = "default" }) {
  return <article className={"stat-card " + tone}>
    <span className="stat-icon"><Icon size={18}/></span>
    <small>{label}</small><b>{value}</b>{hint && <em>{hint}</em>}
  </article>;
}

function PublicAssessment({ summary, signals = [] }) {
  if (!summary) return null;
  const verdict = deriveDisplayNationalSummary(summary, signals);
  const tone = verdict.tone || "neutral";
  return <section className={"public-assessment " + tone}>
    <div className="public-assessment-head">
      <div>
        <small>جمع‌بندی ساده · وضعیت فعلی اینترنت ایران</small>
        <h2>{verdict.title}</h2>
        <p>{verdict.summary}</p>
      </div>
      <span className="public-verdict">{verdict.condition_label}</span>
    </div>
    <div className="public-verdict-grid">
      <article>
        <small>آیا نشانهٔ قطع گسترده هست؟</small>
        <b>{verdict.outage_label}</b>
        <p>{verdict.outage_detail}</p>
      </article>
      <article>
        <small>وضعیت پایداری زیرساخت</small>
        <b>{verdict.stability_label}</b>
        <p>این ارزیابی از دو شاخص اصلیِ مسیرهای اینترنت و پاسخ‌گویی شبکه‌ها استفاده می‌کند.</p>
      </article>
      <article>
        <small>کیفیت اینترنت برای کاربران</small>
        <b>{verdict.quality_label}</b>
        <p>{verdict.quality_detail}</p>
      </article>
      <article>
        <small>روند یک ساعت اخیر</small>
        <b>{verdict.trend_label}</b>
        <p>{verdict.trend_detail}</p>
      </article>
      <article>
        <small>میزان اطمینان به این جمع‌بندی</small>
        <b>{verdict.confidence_label}</b>
        <p>{verdict.confidence_detail}</p>
      </article>
    </div>
    <div className="public-explanation">
      <b>این نتیجه از کجا آمده؟</b>
      <ul>{(verdict.reasoning || []).map((item) => <li key={item}>{item}</li>)}</ul>
      <p>{verdict.scope_note}</p>
    </div>
  </section>;
}


function PublicStatus({ summary, checkedAt }) {
  if (!summary) return <section className="public-status neutral">
    <div><small>وضعیت اینترنت ایران</small><h2>در حال دریافت آخرین وضعیت</h2><p>نتیجهٔ آخرین بررسی در این بخش نمایش داده می‌شود.</p></div>
  </section>;

  const states = {
    stable: ["پایدار", "good", "شاخص‌های اصلی در محدودهٔ معمول هستند و وضعیت کلی اینترنت پایدار و عادی است."],
    stable_limited: ["فعلاً پایدار", "good", "در آخرین شاخص تازه افت غیرعادی دیده نشده، اما به دلیل محدودیت داده، اطمینان ارزیابی ملی پایین‌تر است."],
    attention: ["نیازمند توجه", "warn", "در یکی از شاخص‌های اصلی تغییر غیرعادی دیده شده؛ هنوز شواهد کافی برای نتیجه‌گیری دربارهٔ کل شبکه وجود ندارد."],
    possible_disruption: ["احتمال اختلال", "danger", "هر دو شاخص اصلی افت هم‌زمان نشان داده‌اند؛ این وضعیت نیازمند بررسی بیشتر است."],
    unknown: ["وضعیت نامشخص", "neutral", "برای نتیجهٔ قابل اتکا، دادهٔ تازه و تاریخچهٔ کافی از هر دو شاخص اصلی در دسترس نیست."],
  };
  const [label, tone, description] = states[summary.condition] || states.unknown;
  return <section className={"public-status " + tone}>
    <div className="public-status-main">
      <small>وضعیت اینترنت ایران</small>
      <div className="public-status-title"><h2>{label}</h2><span>{summary.condition_label || label}</span></div>
      <p>{description}</p>
      <em>آخرین مشاهدهٔ شاخص‌های اصلی: {time(checkedAt)}</em>
    </div>
    <div className="public-status-details">
      <article><small>پایداری زیرساخت</small><b>{summary.stability_label || "نامشخص"}</b></article>
      <article><small>روند یک ساعت اخیر</small><b>{summary.trend_label || "نامشخص"}</b></article>
      <article><small>اطمینان ارزیابی</small><b>{summary.confidence_label || "نامشخص"}</b></article>
    </div>
    <div className="public-status-note">سرعت و کیفیت تجربهٔ شخصی کاربران مستقیماً اندازه‌گیری نمی‌شود.</div>
  </section>;
}

function PublicSituationReport({ summary, signals = [], intelligence, censorship, providers, datacenters, dataQuality, checkedAt, isLoading, error }) {
  // The API serves a precomputed snapshot. Do not show a fake "waiting for enough data"
  // state before that saved snapshot has been read by the browser.
  if (!summary && !signals.length) {
    if (isLoading) return null;
    return <section className="public-assessment neutral">
      <div className="public-assessment-head">
        <div>
          <small>گزارش عمومی نت‌گارد · وضعیت اینترنت داخل ایران</small>
          <h2>گزارش ذخیره‌شده در دسترس نیست</h2>
          <p>{error || "خواندن آخرین Snapshot از سرویس پایش با مشکل روبه‌رو شده است."}</p>
        </div>
        <span className="public-verdict">خطا در دریافت</span>
      </div>
    </section>;
  }

  const signalFor = (name) => signals.find((item) => item.signal === name);
  const bgp = signalFor("bgp");
  const ping = signalFor("ping-slash24");
  const merit = signalFor("merit-nt");
  const hasValue = (item) => item && item.latest_value != null && Number.isFinite(Number(item.latest_value));
  const signalSentence = (item, label, contextOnly = false) => {
    if (!hasValue(item)) return null;
    const freshnessText = item.freshness_status === "stale"
      ? "آخرین مشاهده قدیمی است"
      : item.freshness_status === "fresh"
        ? "آخرین مشاهده تازه است"
        : "تازگی آخرین مشاهده نامشخص است";
    const trendText = item.trend_1h_label || item.plain_explanation || "روند قابل محاسبه نیست";
    return `${label}: ${number(item.latest_value)} ${item.unit || ""}؛ آخرین مشاهده ${time(item.last_observed_at)}؛ ${freshnessText}. ${contextOnly ? "این شاخص فقط شاهد کمکی است و به‌تنهایی وضعیت اینترنت را تعیین نمی‌کند." : trendText}`;
  };

  // An indeterminate backend verdict can still support a qualified national status
  // when one fresh primary signal is usable and shows no anomaly.
  const limitedVerdict = deriveLimitedNationalVerdict({ bgp, ping });
  const bestEffortSummary = {
    ...(summary || {}),
    ...limitedVerdict,
    summary: [
      hasValue(ping)
        ? `در آخرین مشاهدهٔ شاخص پاسخ‌گویی شبکه، مقدار ${number(ping.latest_value)} ثبت شده و ${ping.trend_1h_label || "روند یک‌ساعته قابل محاسبه نیست"}؛ ${ping.current_anomaly ? "این شاخص انحرافی نیازمند بررسی نشان می‌دهد." : "انحرافی بالاتر از آستانهٔ تشخیص ثبت نشده است."}`
        : "برای شاخص پاسخ‌گویی شبکه مقدار ذخیره‌شده‌ای در این Snapshot موجود نیست.",
      hasValue(bgp)
        ? `شاخص دیدپذیری مسیرهای اینترنت مقدار ${number(bgp.latest_value)} را در ${time(bgp.last_observed_at)} ثبت کرده، اما ${bgp.freshness_status === "stale" ? "این مشاهده از حد تازگی عبور کرده است." : "تازگی این مشاهده باید همراه سایر شاخص‌ها سنجیده شود."}`
        : "مقدار ذخیره‌شدهٔ شاخص دیدپذیری BGP موجود نیست.",
      limitedVerdict.summary,
    ].filter(Boolean).join(" "),
    trend_label: ping?.trend_1h_label || bgp?.trend_1h_label || "روند از داده‌های موجود قابل محاسبه نیست",
    trend_detail: [
      ping?.trend_1h_label ? `پایش فعال: ${ping.trend_1h_label}.` : null,
      bgp?.trend_1h_label ? `دیدپذیری BGP: ${bgp.trend_1h_label}.` : null,
    ].filter(Boolean).join(" ") || "برای تعیین روند باید نمونه‌های زمانی بیشتری در دسترس باشد.",
    confidence_label: limitedVerdict.confidence_label,
    confidence_detail: "نتایج از مقادیر ذخیره‌شده نمایش داده می‌شوند؛ قدیمی بودن یا کم بودن نمونه‌های یک منبع، اطمینان به جمع‌بندی ملی را کاهش می‌دهد.",
    reasoning: [
      signalSentence(bgp, "دیدپذیری مسیرهای اینترنت"),
      signalSentence(ping, "پاسخ‌گویی شبکه در پایش فعال"),
      signalSentence(merit, "تلسکوپ شبکه (Merit)", true),
    ].filter(Boolean),
    scope_note: "این گزارش آخرین Snapshot موجود را نمایش می‌دهد. دادهٔ ناقص یا قدیمی حذف نمی‌شود؛ محدودیت آن کنار همان شاخص توضیح داده می‌شود.",
  };
  const displaySummary = summary?.condition === "unknown" ? bestEffortSummary : (summary || bestEffortSummary);

  const coverageDescription = describeCoverage(dataQuality);
  const forecast = intelligence?.forecast || {};
  const providerList = Array.isArray(providers) ? providers : (providers?.providers || []);
  const infrastructure = providerList.filter((item) => item.group === "infrastructure");
  const affectedInfrastructure = infrastructure.filter((item) =>
    ["degraded_performance", "partial_outage", "major_outage"].includes(item.status)
  );
  const cloudflare = infrastructure.find((item) => item.id === "cloudflare");
  const domesticCount = Number(datacenters?.total_sites || 0);
  const directlyMonitored = Number(datacenters?.directly_monitored || 0);
  const measuredDomains = Number(censorship?.total_domains_observed || 0);
  const confirmedDomains = Number(censorship?.confirmed_domain_count || 0);
  const anomalyDomains = Number(censorship?.anomaly_domain_count || 0);
  const forecastText = forecast.available
    ? `در افق آزمایشی ${number(forecast.horizon_minutes || 30, 0)} دقیقه، امتیاز نشانه‌های افت ${number(forecast.risk_index, 0)} از ۱۰۰ است: ${forecast.risk_label || "بدون برچسب"}.`
    : "در این Snapshot پیش‌بینی عددی منتشر نشده است؛ روندهای قابل محاسبهٔ هر شاخص در بخش هوش مصنوعی جداگانه نمایش داده می‌شوند.";
  const providerText = infrastructure.length
    ? `${number(infrastructure.length, 0)} سرویس زیرساختی بین‌المللی بین منابع بررسی‌شده‌اند؛ ${number(affectedInfrastructure.length, 0)} مورد در صفحهٔ رسمی خود نشانهٔ افت یا اختلال اعلام کرده‌اند.`
    : "اطلاعات وضعیت سرویس‌های زیرساختی جهانی هنوز در دسترس نیست.";
  const tone = displaySummary.tone || "neutral";
  return <section className={"public-assessment " + tone}>
    <div className="public-assessment-head">
      <div>
        <small>گزارش عمومی نت‌گارد · وضعیت اینترنت داخل ایران</small>
        <h2>{displaySummary.title}</h2>
        <p>{displaySummary.summary}</p>
      </div>
      <span className="public-verdict">{displaySummary.condition_label || "آخرین دادهٔ ذخیره‌شده"}</span>
    </div>
    <div className="situation-grid">
      <article><small>اتصال و مسیرهای اینترنت</small><b>{displaySummary.stability_label || "نامشخص"}</b><p>{displaySummary.outage_detail || "توضیح وضعیت از آخرین شاخص‌های ذخیره‌شده در دسترس است."}</p></article>
      <article><small>دسترسی به وب‌سایت‌ها</small><b>{number(confirmedDomains, 0)} دامنه با شاهد مسدودسازی</b><p>{measuredDomains ? `در ${number(measuredDomains, 0)} دامنه نتیجهٔ آزمون OONI وجود دارد؛ ${number(anomalyDomains, 0)} مورد دیگر نشانهٔ اختلال دارند، اما لزوماً فیلترشده نیستند.` : "نتایج آزمون دسترسی در آخرین Snapshot موجود نیست."}</p></article>
      <article><small>مراکز داده داخل ایران</small><b>{number(domesticCount, 0)} مرکز یا محل میزبانی ثبت‌شده</b><p>{directlyMonitored ? `${number(directlyMonitored, 0)} مورد پایش مستقیم دارند.` : "برای مراکز فهرست‌شده هنوز سنجش زندهٔ مستقل NetGuard از داخل ایران نداریم؛ بنابراین وضعیت عملیاتی آن‌ها نامشخص است."}</p></article>
      <article><small>زیرساخت خارج از ایران</small><b>{number(cloudflare?.data_center_count, 0)} نقطهٔ حضور Cloudflare</b><p>{providerText} این وضعیت‌ها جهانی‌اند و به‌تنهایی دسترسی از داخل ایران را ثابت نمی‌کنند.</p></article>
      <article><small>روند یک ساعت اخیر</small><b>{displaySummary.trend_label || "نامشخص"}</b><p>{displaySummary.trend_detail || "روند بر اساس آخرین نمونه‌های ذخیره‌شده نمایش داده می‌شود."}</p></article>
      <article><small>چشم‌انداز کوتاه‌مدت</small><b>{forecast.available ? `امتیاز نشانه‌های افت: ${number(forecast.risk_index, 0)} از ۱۰۰` : "روند قابل اندازه‌گیری؛ پیش‌بینی عددی منتشر نشده"}</b><p>{forecastText} این امتیاز احتمال قطعی یا پیش‌بینی قطعی خاموشی نیست.</p></article>
      <article><small>کیفیت و اطمینان داده</small><b>{displaySummary.confidence_label || "محدود"} · پوشش نمونه‌ها در بازهٔ {coverageDescription.windowLabel}: {number(dataQuality?.window_coverage_percent, 0)}٪</b><p>{displaySummary.confidence_detail || "تازگی و کامل بودن داده‌ها بر میزان اطمینان اثر می‌گذارد."} {coverageDescription.detail}</p></article>
    </div>
    <div className="public-explanation">
      <b>جمع‌بندی را چطور بخوانیم؟</b>
      <ul>
        {(displaySummary.reasoning || []).map((item) => <li key={item}>{item}</li>)}
        <li>آزمون‌های OONI دربارهٔ دسترسی به دامنه‌های آزمایش‌شده‌اند؛ همهٔ سایت‌ها یا همهٔ اپراتورها را پوشش نمی‌دهند.</li>
        <li>وضعیت جهانی شرکت‌ها و فهرست دیتاسنترها جای اندازه‌گیری مستقیم از شهرها و اپراتورهای داخل ایران را نمی‌گیرد.</li>
      </ul>
      <p>{displaySummary.scope_note || "این گزارش بر شواهد عمومی و ملی تکیه دارد و کیفیت اتصال تک‌تک کاربران را اندازه نمی‌گیرد."} آخرین مشاهدهٔ شاخص‌های اصلی: {time(checkedAt)} · آخرین آزمون OONI: {time(censorship?.sync?.finished_at)} · آخرین بررسی زیرساخت جهانی: {time(providers?.checked_at)}.</p>
    </div>
  </section>;
}

function Chart({ rows = [], compact = false }) {
  const valid = rows.filter((row) => row.quality === "valid" && Number.isFinite(Number(row.value)));
  if (!valid.length) return <Empty title="تاریخچهٔ معتبری موجود نیست" />;
  const values = valid.map((row) => Number(row.value));
  const min = Math.min(...values), max = Math.max(...values);
  const span = Math.max(max - min, Math.abs(max) * 0.0001, 0.000001);
  const points = valid.map((row, index) => {
    const x = 22 + index / Math.max(1, valid.length - 1) * 856;
    const y = 154 - ((Number(row.value) - min) / span) * 122;
    return { x, y, row };
  });
  const line = points.map((point) => point.x + "," + point.y).join(" ");
  const area = "22,154 " + line + " 878,154";
  return <div className={"chart " + (compact ? "compact" : "")}>
    {!compact && <div className="chart-range"><span>کمینه: <b>{number(min)}</b></span><span>بیشینه: <b>{number(max)}</b></span></div>}
    <svg viewBox="0 0 900 174" preserveAspectRatio="none" role="img" aria-label="نمودار تاریخی سیگنال">
      <defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#63d7b7" stopOpacity=".22"/><stop offset="100%" stopColor="#63d7b7" stopOpacity="0"/></linearGradient></defs>
      {[32, 93, 154].map((y) => <line key={y} x1="22" x2="878" y1={y} y2={y}/>)}
      <polygon points={area} fill="url(#chart-fill)"/>
      <polyline points={line} fill="none" stroke="#63d7b7" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>
      {points.filter((_, index) => index === points.length - 1 || index % Math.max(1, Math.floor(points.length / 8)) === 0).map((point) =>
        <circle key={point.row.observed_at} cx={point.x} cy={point.y} r="3.5" fill="#a4f0dc" stroke="#0e1929" strokeWidth="2">
          <title>{time(point.row.observed_at) + " · " + number(point.row.value)}</title>
        </circle>
      )}
    </svg>
    <div className="axis"><span>{time(valid[0].observed_at)}</span><span>{time(valid.at(-1).observed_at)}</span></div>
  </div>;
}
function sourcePlain(signal) {
  if (signal === "bgp") return "بررسی می‌کند چه تعداد از مسیرهای اینترنت در شبکهٔ جهانی دیده می‌شوند.";
  if (signal === "ping-slash24") return "بررسی می‌کند چه تعداد از نشانی‌های نمونه در اینترنت پاسخ می‌دهند.";
  if (signal === "merit-nt") return "تغییرات مشاهده‌شده در ترافیک و نشانی‌های شبکه را دنبال می‌کند.";
  return "یک بخش از وضعیت زیرساخت اینترنت را اندازه می‌گیرد.";
}
function SourceTable({ rows = [] }) {
  if (!rows.length) return <Empty title="منبع فعالی در پاسخ API نیست" />;
  return <div className="table-wrap"><table>
    <thead><tr><th>چه چیزی بررسی می‌شود؟</th><th>وضعیت دریافت</th><th>آخرین اندازه‌گیری</th><th>فاصلهٔ بررسی</th><th>وضعیت به‌روزرسانی</th><th>مقدار آخر</th></tr></thead>
    <tbody>{rows.map((source) => <tr key={source.source_id}>
      <td><b>{source.display_name}</b><small>{sourcePlain(source.signal)}</small><details className="technical-details" open><summary>نام فنی و منبع</summary><span>{source.provider} · {source.signal}</span></details></td>
      <td><Badge value={source.freshness_status}/></td>
      <td>{time(source.last_observed_at)}<small>{source.observation_age_seconds == null ? "زمان مشاهده نامشخص" : number(Math.floor(source.observation_age_seconds / 60), 0) + " دقیقه پیش"}</small></td>
      <td><b>{source.expected_interval_seconds ? number(source.expected_interval_seconds / 60, 0) + " دقیقه" : "—"}</b></td>
      <td>{time(source.last_run_started_at)}<small>{source.last_run_status === "success" ? "دریافت موفق" : source.last_run_status === "error" ? "خطا در دریافت" : source.last_run_status === "no_data" ? "دادهٔ تازه‌ای نبود" : "وضعیت اجرا نامشخص"}</small>
        <details className="technical-details"><summary>جزئیات فنی دریافت</summary><span>{source.stale_after_seconds ? "حد هشدار " + number(source.stale_after_seconds / 60, 0) + " دقیقه" : ""}{source.last_run_duration_ms != null ? " · " + number(source.last_run_duration_ms, 0) + " میلی‌ثانیه" : ""}{source.last_run_records_received != null ? " · " + number(source.last_run_records_received, 0) + " ردیف" : ""}{source.last_run_error_code ? " · " + source.last_run_error_code : ""}</span></details>
      </td>
      <td><b>{number(source.latest_value)}</b><small>{source.unit}</small></td>
    </tr>)}</tbody>
  </table></div>;
}
function EventCard({ event }) {
  const Direction = event.direction === "drop" ? TrendingDown : event.direction === "spike" ? TrendingUp : Activity;
  return <article className={"event-card severity-" + (eventSeverity[event.severity] || eventSeverity.info)[1]}>
    <div className="event-top">
      <div className="event-title">
        <span className="event-icon"><Direction size={19}/></span>
        <div><small>{eventTypeLabel[event.event_type] || "رخداد پایش"}</small><h3>{event.title}</h3></div>
      </div>
      <Badge value={event.severity} map={eventSeverity}/>
    </div>
    <p className="event-description">{event.description}</p>
    <div className="event-metrics">
      {event.change_percent != null && <div><small>تغییر نسبت به مبنا</small><b className={event.change_percent < 0 ? "negative" : "positive"}>{event.change_percent > 0 ? "+" : ""}{number(event.change_percent)}٪</b></div>}
      {event.baseline_value != null && <div><small>خط مبنا</small><b>{number(event.baseline_value)} <em>{event.unit}</em></b></div>}
      {event.observed_value != null && <div><small>مقدار مشاهده‌شده</small><b>{number(event.observed_value)} <em>{event.unit}</em></b></div>}
      {event.evidence_score != null && <div><small>امتیاز اولویت بررسی</small><b>{number(event.evidence_score, 0)} از ۱۰۰</b></div>}
    </div>
    <div className="event-bottom">
      <div><b>{event.source_name || "NetGuard"}</b><small>{["source_stale", "source_delayed"].includes(event.event_type)
        ? "آخرین مشاهده: " + time(event.last_observed_at || event.start_at) + " · آخرین بررسی: " + time(event.last_collected_at || event.occurred_at)
        : event.event_type === "collector_error"
          ? "آخرین اجرای ناموفق: " + time(event.occurred_at) + " · آخرین مشاهده: " + time(event.last_observed_at)
          : time(event.start_at || event.occurred_at) + (event.end_at && event.end_at !== event.start_at ? " تا " + time(event.end_at) : "")}</small></div>
      <span className={"event-status " + (event.lifecycle === "active" || event.status === "suspected" ? "warn" : "")}>{[event.lifecycle_label, event.status_label].filter(Boolean).join(" · ") || (event.status === "suspected" ? "مشکوک؛ نیازمند تأیید" : "وضعیت زمانی نامشخص")}</span>
    </div>
    {event.corroborating_sources?.length > 0 && <div className="corroboration"><ShieldAlert size={14}/> هم‌زمانی با {number(event.corroborating_sources.length, 0)} شاخص مستقل دیگر شناسایی شده است؛ این هم‌زمانی اثبات علت نیست.</div>}
  </article>;
}


function QualityBar({ value }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return <div className="quality-bar" role="img" aria-label={"پوشش " + number(safe, 1) + " درصد"}>
    <span style={{ width: safe + "%" }}/>
  </div>;
}

function SourceQualityCard({ item }) {
  return <article className="source-quality-card">
    <div className="source-quality-head"><div><small>آنچه این شاخص می‌سنجد</small><h3>{item.display_name}</h3></div><Badge value={item.freshness_status}/></div>
    <p className="provider-simple-copy">{sourcePlain(item.signal)} پوشش نشان می‌دهد چند بررسی از تعداد برنامه‌ریزی‌شده واقعاً ثبت شده است.</p>
    <div className="quality-main-value"><b>{number(item.sample_coverage_percent, 1)}٪</b><span>بررسی‌های ثبت‌شده</span></div>
    <QualityBar value={item.sample_coverage_percent}/>
    <details className="technical-details"><summary>جزئیات فنی و کیفیت تاریخچه</summary>
      <div className="quality-mini-grid">
        <div><small>فاصلهٔ مورد انتظار</small><b>{number(item.expected_interval_minutes, 0)} دقیقه</b></div>
        <div><small>نمونهٔ معتبر</small><b>{number(item.valid_samples, 0)} / {number(item.expected_samples_in_window, 0)}</b></div>
        <div><small>طول تاریخچه</small><b>{number(item.observed_span_hours, 1)} ساعت</b></div>
        <div><small>آخرین مشاهده</small><b>{item.observation_age_seconds == null ? "—" : number(item.observation_age_seconds / 60, 0) + " دقیقه قبل"}</b></div>
        <div><small>میانهٔ فاصله‌ها</small><b>{item.median_gap_seconds == null ? "—" : number(item.median_gap_seconds / 60, 1) + " دقیقه"}</b></div>
        <div><small>صدک ۹۰ فاصله</small><b>{item.p90_gap_seconds == null ? "—" : number(item.p90_gap_seconds / 60, 1) + " دقیقه"}</b></div>
        <div><small>نمونهٔ ۲ ساعت اخیر</small><b>{number(item.samples_last_2h, 0)}</b></div>
        <div><small>نمونهٔ ۳۰ دقیقه اخیر</small><b>{number(item.samples_last_30m, 0)}</b></div>
        <div><small>شکاف‌های غیرمنتظره</small><b>{number(item.gaps_over_expected_threshold, 0)}</b></div>
      </div>
      <div className="source-quality-foot"><span>آخرین جمع‌آوری: {time(item.last_collected_at)}</span><span>آخرین اجرای جمع‌آوری: {item.last_run_status || "نامشخص"}{item.last_run_error_code ? " · " + item.last_run_error_code : ""}</span></div>
    </details>
  </article>;
}

const providerStatusMap = {
  operational: ["عادی", "good"], under_maintenance: ["تعمیرات برنامه‌ریزی‌شده", "neutral"],
  degraded_performance: ["افت کیفیت", "warn"], partial_outage: ["اختلال بخشی", "danger"],
  major_outage: ["اختلال گسترده", "danger"], unknown: ["نامشخص", "neutral"],
};
function ProviderCard({ item }) {
  const locations = item.affected_locations || [];
  const incidents = item.incidents || [];
  return <article className="provider-card">
    <div className="provider-card-head"><div><h3>{item.name}</h3><p>{item.description}</p></div><Badge value={item.status} map={providerStatusMap}/></div>
    {item.summary && <p className="provider-summary">{item.summary}</p>}
    <p className="provider-simple-copy">منبع: صفحهٔ رسمی جهانی · دسترسی از داخل ایران مستقلاً آزمون نشده است.</p>
    {item.components_attention > 0 && item.component_count > 0 && <div className="provider-locations"><b>مؤلفه‌های دارای وضعیت غیرعادی</b><span>{number(item.components_attention, 0)} مورد از {number(item.component_count, 0)} مؤلفهٔ منتشرشده</span>{item.component_status_label && <small>بالاترین شدت در مؤلفه‌ها: {item.component_status_label}</small>}</div>}
    {item.id === "cloudflare" && <div className="provider-datacenter">
      <div><b>{number(item.data_center_count, 0)}</b><span>مرکز یا نقطهٔ حضور در فهرست رسمی</span></div>
      <div><b>{number(item.components_attention, 0)}</b><span>مورد دارای وضعیت غیرعادی</span></div>
    </div>}
    {locations.length > 0 && <div className="provider-locations"><b>مکان‌هایی با وضعیت غیرعادی</b>
      {locations.slice(0, 8).map((location) => <span key={location.name}>{location.name} · {location.status_label}</span>)}
      {locations.length > 8 && <small>و {number(locations.length - 8, 0)} مورد دیگر</small>}
    </div>}
    {incidents.length > 0 && <div className="provider-incidents"><b>رخدادهای اعلام‌شده</b>
      {incidents.slice(0, 3).map((incident, index) => <div key={incident.name + index}>
        <span>{incident.name}</span>
        {incident.affected_components?.length > 0 && <small>مؤلفه‌های درگیر: {incident.affected_components.join("، ")}</small>}
        <small>{incident.impact || incident.status || ""} · {incident.body}</small>
      </div>)}
    </div>}
    <div className="provider-card-foot"><span>بررسی نت‌گارد: {time(item.checked_at)}</span>
      {item.provider_updated_at && <span>آخرین تغییر صفحهٔ رسمی: {time(item.provider_updated_at)}</span>}
      <a href={item.url} target="_blank" rel="noreferrer">صفحهٔ رسمی وضعیت ↗</a>
    </div>
    {(item.technical_components?.length > 0 || incidents.length > 0) && <details className="technical-details">
      <summary>جزئیات فنی سرویس‌ها و مؤلفه‌ها</summary>
      {item.technical_components?.length > 0 && <div className="provider-tech-list">{item.technical_components.slice(0, 24).map((component) =>
        <span key={component.name}>{component.name} · {component.status_label}</span>)}</div>}
      {incidents.map((incident, index) => <p key={incident.name + "-full-" + index}>{incident.name}: {incident.body}</p>)}
    </details>}
  </article>;
}

export default function App() {
  const [page, setPage] = useState("overview");
  const [windowHours, setWindowHours] = useState(168);
  const [eventFilter, setEventFilter] = useState("all");
  const [showOverviewDetails, setShowOverviewDetails] = useState(false);
  const [siteFilter, setSiteFilter] = useState("all");
  const [siteQuery, setSiteQuery] = useState("");
  const [snapshotStore, setSnapshotStore] = useState(() => {
    const rows = readCachedSnapshotRows();
    return { byKey: indexSnapshotRows(rows), loaded: rows.length > 0 };
  });
  const [snapshotError, setSnapshotError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshInFlight = useRef(false);
  const pendingKeysRef = useRef(new Set());

  const keysForPage = useMemo(() => {
    if (page === "censorship") return ["censorship"];
    if (page === "providers") return ["providers_status", "iran_datacenters"];
    if (page === "method") return [];
    return [`dashboard_${windowHours}`];
  }, [page, windowHours]);

  const dashboardSnapshot = snapshotStore.byKey[`dashboard_${windowHours}`];
  const data = dashboardSnapshot
    ? { ...dashboardSnapshot, error: "", busy: false, window_hours: windowHours }
    : {
        sources: [], observations: [], analysis: null, events: [],
        generated_at: null, error: snapshotStore.loaded
          ? (snapshotError || "Snapshot این بازه در دسترس نیست.")
          : "",
        busy: !dashboardSnapshot, window_hours: windowHours,
      };
  const censorshipSnapshot = snapshotStore.byKey.censorship;
  const censorship = censorshipSnapshot
    ? {
        ...censorshipSnapshot,
        domains: Array.isArray(censorshipSnapshot.domains) ? censorshipSnapshot.domains : [],
        error: "", busy: false,
      }
    : {
        domains: [], sync: null, generated_at: null,
        error: snapshotError || "",
        busy: !censorshipSnapshot,
      };
  const providerSnapshot = snapshotStore.byKey.providers_status;
  const providerData = providerSnapshot
    ? {
        ...providerSnapshot,
        providers: Array.isArray(providerSnapshot.providers) ? providerSnapshot.providers : [],
        error: "", busy: false,
      }
    : {
        providers: [], checked_at: null,
        error: snapshotError || "",
        busy: !providerSnapshot,
      };
  const datacenterSnapshot = snapshotStore.byKey.iran_datacenters;
  const datacenterData = datacenterSnapshot
    ? {
        ...datacenterSnapshot,
        sites: Array.isArray(datacenterSnapshot.sites) ? datacenterSnapshot.sites : [],
        error: "", busy: false,
      }
    : {
        sites: [], snapshot_at: null,
        error: snapshotError || "",
        busy: !datacenterSnapshot,
      };

  const loadSnapshots = useCallback(async (requestedKeys = keysForPage) => {
    const keys = [...new Set(requestedKeys)].filter((key) => SNAPSHOT_KEYS.includes(key));
    if (!keys.length) return;
    if (refreshInFlight.current) {
      keys.forEach((key) => pendingKeysRef.current.add(key));
      return;
    }
    refreshInFlight.current = true;
    setIsRefreshing(true);
    try {
      if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
        throw new Error("تنظیم اتصال عمومی Supabase در سایت کامل نیست.");
      }
      const query = new URLSearchParams({
        select: "dataset_key,payload,collected_at,status,source_count,error_code",
        dataset_key: `in.(${keys.join(",")})`,
      });
      const response = await fetch(`${SUPABASE_URL}/rest/v1/netguard_snapshots?${query}`, {
        headers: {
          Accept: "application/json",
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || payload?.details || `خواندن Snapshot ناموفق بود (${response.status}).`);
      }
      if (!Array.isArray(payload) || !payload.some((row) => keys.includes(row.dataset_key))) {
        throw new Error("Snapshot درخواستی از پایگاه داده دریافت نشد.");
      }
      const rows = payload.filter((row) => keys.includes(row.dataset_key));
      const cachedRows = readCachedSnapshotRows().filter((row) => !keys.includes(row.dataset_key));
      const mergedRows = [...cachedRows, ...rows];
      try {
        localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify({
          version: 1,
          savedAt: Date.now(),
          rows: mergedRows,
        }));
      } catch {
        // The live response remains usable when browser storage is unavailable or full.
      }
      setSnapshotStore((current) => ({
        byKey: { ...current.byKey, ...indexSnapshotRows(rows) },
        loaded: true,
      }));
      setSnapshotError("");
    } catch (error) {
      setSnapshotStore((current) => ({ ...current, loaded: true }));
      setSnapshotError(error?.message || "دریافت آخرین Snapshot ناموفق بود.");
    } finally {
      refreshInFlight.current = false;
      setIsRefreshing(false);
      if (pendingKeysRef.current.size) {
        const pendingKeys = [...pendingKeysRef.current];
        pendingKeysRef.current.clear();
        loadSnapshots(pendingKeys);
      }
    }
  }, [keysForPage]);

  useEffect(() => {
    loadSnapshots(keysForPage);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") loadSnapshots(keysForPage);
    };
    const timer = window.setInterval(refreshWhenVisible, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadSnapshots, keysForPage]);

  const groups = useMemo(() => data.observations.reduce((accumulator, row) => {
    (accumulator[row.source_id] ||= []).push(row);
    return accumulator;
  }, {}), [data.observations]);
  const analysis = data.analysis || {};
  const signals = analysis.signals || [];
  const dataQuality = analysis.data_quality || {};
  const qualitySources = dataQuality.source_details || [];
  const events = data.events || [];
  const counts = data.sources.reduce((result, source) => {
    result[source.freshness_status] = (result[source.freshness_status] || 0) + 1;
    return result;
  }, {});
  const fresh = counts.fresh || 0;
  const attention = (counts.stale || 0) + (counts.degraded || 0);
  const overall = !data.sources.length ? "وضعیت دریافت داده نامشخص" : fresh === data.sources.length ? "داده‌های پایش به‌روز هستند" : "دریافت داده نیازمند بررسی";
  const current = NAV.find((item) => item[0] === page) || NAV[0];
  const filteredEvents = useMemo(() => events.filter((event) =>
    eventFilter === "all" || event.severity === eventFilter
  ), [events, eventFilter]);
  const confirmedSites = censorship.domains.filter((site) => site.confirmed_blocked);
  const possibleSites = censorship.domains.filter((site) => site.has_measurements && !site.confirmed_blocked);
  const candidateSites = censorship.domains.filter((site) => site.candidate_only);
  const filteredDomains = useMemo(() => {
    const query = siteQuery.trim().toLowerCase();
    return censorship.domains.filter((site) => {
      const matchesFilter = siteFilter === "all"
        || (siteFilter === "confirmed" && site.confirmed_blocked)
        || (siteFilter === "possible" && site.has_measurements && !site.confirmed_blocked)
        || (siteFilter === "candidates" && site.candidate_only);
      return matchesFilter && (!query || String(site.domain || "").toLowerCase().includes(query));
    });
  }, [censorship.domains, siteFilter, siteQuery]);
  const lastPrimaryObservation = data.sources
    .filter((source) => ["bgp", "ping-slash24"].includes(source.signal))
    .map((source) => source.last_observed_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  let body;
  if (page === "overview") body = <>
    <PublicSituationReport summary={analysis.public_summary} signals={signals} intelligence={analysis.intelligence} censorship={censorship} providers={providerData} datacenters={datacenterData} dataQuality={dataQuality} checkedAt={lastPrimaryObservation} isLoading={data.busy} error={data.error}/>
    <div className="hero">
      <div><small>سلامت سامانهٔ پایش · ایران</small><h2>{overall}</h2>
        <p>{number(fresh, 0)} منبع تازه · {number(attention, 0)} منبع قدیمی یا خطادار</p>
        <div className="meta"><span>آخرین مشاهده: {time(data.sources.map((source) => source.last_observed_at).filter(Boolean).sort().at(-1))}</span><span>آخرین دریافت API: {time(data.generated_at)}</span></div>
      </div><div className="orb"><Globe2 size={40}/><b>IR</b></div>
    </div>
    <div className="plain-explanation"><b>این گزارش چه چیزهایی را کنار هم می‌گذارد؟</b><p>نت‌گارد مسیرهای قابل مشاهدهٔ اینترنت، پاسخ‌گویی شبکه، نتایج آزمون دسترسی به وب‌سایت‌ها، روند تغییرات، کیفیت داده و اعلام اختلال سرویس‌های جهانی را بررسی می‌کند. به همین دلیل به‌جای یک برچسب ساده مثل «پایدار»، توضیح می‌دهد چه چیزی مشاهده شده، چه چیزی هنوز معلوم نیست و پیش‌بینی کوتاه‌مدت چقدر محدودیت دارد.</p></div>
    <button className="detail-toggle" type="button" aria-expanded={showOverviewDetails} onClick={() => setShowOverviewDetails((value) => !value)}>{showOverviewDetails ? "بستن جزئیات فنی داشبورد" : "نمایش جزئیات فنی داشبورد"} <span>{showOverviewDetails ? "−" : "+"}</span></button>
    {showOverviewDetails && <section className="technical-expansion">
    <div className="section-kicker">جزئیات فنی سامانهٔ پایش</div>
    <div className="metrics">
      {[[RadioTower, "منابع ثبت‌شده", data.sources.length], [CheckCircle2, "منابع تازه", fresh], [AlertTriangle, "قدیمی یا خطادار", attention], [Activity, "مشاهدات بازه", data.observations.length]].map(([Icon, label, value]) =>
        <Stat key={label} icon={Icon} label={label} value={number(value, 0)} hint="دادهٔ ثبت‌شده"/>
      )}
    </div>
    <Panel tag="کیفیت تاریخچه" title="پوشش واقعی بازهٔ انتخاب‌شده" note={dataQuality.interpretation || "پوشش تاریخچه، تازگی آخرین مشاهده و پیوستگی نمونه‌ها جداگانه محاسبه می‌شوند."}>
      <div className="overview-quality-grid">
        <div><small>پوشش نمونه‌ها در بازه</small><b>{number(dataQuality.window_coverage_percent, 1)}٪</b><QualityBar value={dataQuality.window_coverage_percent}/></div>
        <div><small>طول زمانی تاریخچه</small><b>{number(dataQuality.observed_span_percent, 1)}٪</b><QualityBar value={dataQuality.observed_span_percent}/></div>
        <div><small>نمونهٔ معتبر</small><b>{number(dataQuality.valid_observations, 0)} / {number(dataQuality.expected_observations, 0)}</b><span>{number(dataQuality.invalid_observations, 0)} نمونهٔ نامعتبر یا حذف‌شده</span></div>
      </div>
      <button className="text-action" onClick={() => setPage("quality")}>بررسی کیفیت و پیوستگی داده‌ها <ArrowDownRight size={15}/></button>
    </Panel>
    <div className="columns">
      <Panel tag="تحلیل وضعیت" title={analysis.assessment_label || "منتظر داده"} note={analysis.summary || "تحلیل پس از دریافت تاریخچهٔ کافی نمایش داده می‌شود."}>
        <div className="inline-meta"><Badge value={analysis.assessment} map={Object.fromEntries(Object.entries(assessmentTone).map(([key, tone]) => [key, [analysis.assessment_label || key, tone]]))}/><span>پوشش داده: {number(analysis.data_coverage_percent, 0)}٪</span></div>
        <button className="text-action" onClick={() => setPage("analysis")}>مشاهدهٔ تحلیل کامل <ArrowDownRight size={15}/></button>
      </Panel>
      <Panel tag="رخدادهای اخیر" title="موارد نیازمند بررسی">
        {events.length ? <div className="event-mini-list">{events.slice(0, 3).map((event) => <div className="event-mini" key={event.event_id}><AlertTriangle size={16}/><div><b>{event.title}</b><small>{event.source_name} · {time(event.occurred_at)}</small></div></div>)}</div> : <Empty title="رخداد تشخیص‌داده‌شده‌ای وجود ندارد" note="نبود رخداد به‌معنی اثبات سلامت کامل شبکه نیست."/>}
        <button className="text-action" onClick={() => setPage("events")}>رفتن به دفتر رخدادها <ArrowDownRight size={15}/></button>
      </Panel>
    </div>
    <Panel tag="سلامت ورودی داده" title="وضعیت منابع"><SourceTable rows={data.sources}/></Panel>
    </section>}
  </>;
  else if (page === "quality") {
    const quality = analysis.data_quality || {};
    const sourceQuality = quality.source_details || [];
    body = <div className="stack">
      <div className="intro page-intro">
        <small><Database size={14}/> کیفیت، پوشش و پیوستگی داده</small>
        <h2>آیا داده برای ارزیابی کافی است؟</h2>
        <p>این صفحه به زبان ساده نشان می‌دهد چند بررسی واقعاً ثبت شده، داده‌ها چقدر تازه‌اند و آیا بین بررسی‌ها فاصلهٔ غیرعادی وجود دارد.</p>
      </div>
      <div className="toolbar">
        <div className="range-tabs" aria-label="بازهٔ بررسی کیفیت">
          {[[24, "۲۴ ساعت"], [72, "۳ روز"], [168, "۷ روز"]].map(([hours, label]) =>
            <button key={hours} className={windowHours === hours ? "active" : ""} onClick={() => setWindowHours(hours)}>{label}</button>
          )}
        </div>
        <span className="toolbar-note">پنجره: {quality.window_start ? time(quality.window_start) : "—"} تا {quality.window_end ? time(quality.window_end) : "—"}</span>
      </div>
      <div className="metrics">
        <Stat icon={Gauge} label="پوشش نمونه در بازه" value={number(quality.window_coverage_percent, 1) + "٪"} hint={quality.coverage_label || "بر اساس cadence هر منبع"}/>
        <Stat icon={Clock3} label="طول تاریخچهٔ موجود" value={number(quality.observed_span_percent, 1) + "٪"} hint="از کل بازهٔ انتخابی"/>
        <Stat icon={Database} label="مشاهدات معتبر" value={number(quality.valid_observations, 0)} hint={"از " + number(quality.expected_observations, 0) + " نمونهٔ مورد انتظار"}/>
        <Stat icon={AlertTriangle} label="منابع با شکاف غیرمنتظره" value={number(quality.sources_with_gaps, 0)} hint={"از " + number(quality.sources_total, 0) + " منبع"}/>
      </div>
      <div className="notice"><Info size={17}/><div>
        <b>چطور این اعداد را بخوانیم؟</b>
        <p>«پوشش نمونه» سهم اندازه‌گیری‌های معتبر از تعداد مورد انتظار با توجه به فاصلهٔ ثبت‌شدهٔ هر منبع است. «طول تاریخچه» نشان می‌دهد اندازه‌گیری‌ها چه بخش زمانی از بازه را پوشش می‌دهند. تازگی آخرین نمونه و شکاف بین نمونه‌ها نیز مستقل‌اند؛ پوشش پایین در بازهٔ ۷ روزه لزوماً به معنی بد بودن داده‌های چند ساعت اخیر نیست.</p>
      </div></div>
      <Panel tag="بررسی مستقل هر منبع" title="کیفیت داده به تفکیک شاخص" note="BGP و Merit معمولاً هر پنج دقیقه و Ping فعال حدود هر ده دقیقه نمونه‌برداری می‌شود؛ cadence هر منبع جداگانه لحاظ شده است.">
        {sourceQuality.length ? <div className="source-quality-grid">{sourceQuality.map((item) => <SourceQualityCard key={item.source_id} item={item}/>)}</div> : <Empty title="هنوز جزئیات کیفیت دریافت نشده" note="پس از دریافت پاسخ جدید API، شاخص‌های کیفیت در این صفحه نمایش داده می‌شوند."/>}
      </Panel>
      <Panel tag="سلامت عملیات" title="وضعیت آخرین دریافت‌ها">
        <SourceTable rows={data.sources}/>
      </Panel>
    </div>;
  }
  else if (page === "analysis") {
    const AssessmentIcon = assessmentIcon[analysis.assessment] || CircleHelp;
    const tone = assessmentTone[analysis.assessment] || "neutral";
    body = <div className="stack">
      <div className="intro page-intro"><small><Activity size={14}/> گزارش پایش ملی</small><h2>ارزیابی وضعیت شبکه</h2><p>این بخش می‌گوید آیا نشانه‌ای از اختلال گسترده دیده می‌شود، چه شواهدی داریم و تا چه اندازه می‌توان به نتیجه اعتماد کرد.</p></div>
      <PublicAssessment summary={analysis.public_summary} signals={analysis.signals}/>
      <section className={"analysis-hero " + tone}>
        <div className="analysis-mark"><AssessmentIcon size={27}/></div>
        <div className="analysis-main"><small>ارزیابی فعلی</small><h2>{analysis.assessment_label || "دادهٔ کافی نیست"}</h2><p>{analysis.summary || "پس از دریافت دادهٔ معتبر، تحلیل نمایش داده می‌شود."}</p>
          <div className="analysis-stamp"><span><Clock3 size={13}/> {time(analysis.generated_at || data.generated_at)}</span><span><RadioTower size={13}/> بررسی چندمنبعی</span></div>
        </div>
        <div className="coverage-ring" style={{ "--coverage": (analysis.data_quality?.window_coverage_percent || 0) + "%" }}><b>{number(analysis.data_quality?.window_coverage_percent, 1)}٪</b><small>پوشش بازه</small></div>
      </section>
      <div className="metrics">
        <Stat icon={Database} label="منابع اصلی قابل استفاده" value={number(analysis.public_summary?.checked_primary_signals, 0) + " / 2"} hint="BGP و پایش فعال"/>
        <Stat icon={Gauge} label="پوشش بازه" value={number(analysis.data_quality?.window_coverage_percent, 1) + "٪"} hint="نمونه‌های معتبر نسبت به انتظار"/>
        <Stat icon={AlertTriangle} label="منابع دارای انحراف" value={number(analysis.anomalous_sources, 0)} hint="انحراف از خط مبنای هر سیگنال" tone={analysis.anomalous_sources ? "warn" : "default"}/>
        <Stat icon={RadioTower} label="منابع تازه" value={number(analysis.fresh_sources, 0)} hint="بر اساس آستانهٔ تازگی منبع"/>
        <Stat icon={Clock3} label="منابع عقب‌مانده از cadence" value={number(analysis.data_quality?.sources_delayed, 0)} hint="آخرین مشاهده بیش از سه فاصلهٔ معمول نمونه‌برداری عقب است"/>
        <Stat icon={Activity} label="رخدادهای پنجره" value={number(analysis.events_count, 0)} hint="رخدادهای شناسایی‌شده"/>
      </div>
      <Panel tag="کیفیت داده" title="پوشش و پیوستگی تاریخچه" note="این درصد نشانهٔ سلامت اینترنت نیست؛ فقط پوشش داده در پنجرهٔ انتخابی را اندازه می‌گیرد.">
        <div className="overview-quality-grid">
          <div><small>پوشش نمونه‌ها</small><b>{number(analysis.data_quality?.window_coverage_percent, 1)}٪</b><QualityBar value={analysis.data_quality?.window_coverage_percent}/></div>
          <div><small>طول بازهٔ مشاهده‌شده</small><b>{number(analysis.data_quality?.observed_span_percent, 1)}٪</b><QualityBar value={analysis.data_quality?.observed_span_percent}/></div>
          <div><small>نمونهٔ معتبر / مورد انتظار</small><b>{number(analysis.data_quality?.valid_observations, 0)} / {number(analysis.data_quality?.expected_observations, 0)}</b><span>{number(analysis.data_quality?.invalid_observations, 0)} نمونهٔ نامعتبر</span></div>
        </div>
        <button className="text-action" onClick={() => setPage("quality")}>جزئیات کیفیت داده <ArrowDownRight size={15}/></button>
      </Panel>
      <Panel tag="نتیجهٔ بررسی شاخص‌ها" title="یافته‌های اصلی" note="هر یافته به دادهٔ مشخص متصل است و نتیجهٔ قطعی دربارهٔ علت اختلال ارائه نمی‌کند.">
        {signals.length ? <div className="finding-list">{signals.map((signal) =>
          <article className="finding" key={signal.source_id}>
            <div className="finding-top"><div><b>{signal.display_name}</b><small>{signal.provider} · {signal.signal}</small></div><Badge value={signal.data_state} map={{usable:["دادهٔ قابل استفاده","good"],insufficient:["تاریخچه ناکافی","neutral"],stale:["داده قدیمی","warn"],limited:["داده محدود","neutral"]}}/></div>
            <p>{signal.current_anomaly
              ? "تغییر " + number(Math.abs(signal.change_percent)) + "٪ نسبت به خط مبنای " + number(signal.baseline_value) + " ثبت شده است؛ این مورد نیازمند بررسی است."
              : signal.data_state === "usable"
                ? "در پنجرهٔ اخیر انحرافی بالاتر از آستانهٔ موتور شناسایی نشده است."
                : "برای این منبع دادهٔ تازه یا تاریخچهٔ کافی در دسترس نیست."}</p>
            <div className="finding-stats"><span>آخرین مقدار <b>{number(signal.latest_value)}</b></span><span>تغییر <b>{signal.change_percent == null ? "—" : (signal.change_percent > 0 ? "+" : "") + number(signal.change_percent) + "٪"}</b></span><span>نمونه‌ها <b>{number(signal.sample_count, 0)}</b></span><span>آخرین مشاهده <b>{time(signal.last_observed_at)}</b></span></div>
          </article>
        )}</div> : <Empty/>}
      </Panel>
      <div className="columns">
        <Panel tag="منطق تحلیل" title="چطور به این نتیجه رسیدیم؟">
          <ol className="method-steps">{(analysis.method || []).map((method, index) => <li key={method}><i>{number(index + 1, 0)}</i><span>{method}</span></li>)}</ol>
        </Panel>
        <Panel tag="محدودیت‌های ارزیابی" title="تفسیر درست نتیجه">
          <ul className="caveats">{(analysis.limitations || []).map((item) => <li key={item}>{item}</li>)}</ul>
        </Panel>
      </div>
      <div className="notice"><Info size={17}/><div><b>مبنای ارزیابی</b><p>NetGuard رفتار هر شاخص را با سابقهٔ همان شاخص مقایسه می‌کند، تغییرات هم‌زمان را میان منابع مستقل می‌سنجد و داده‌های ناقص یا قدیمی را جداگانه در نظر می‌گیرد. نتیجهٔ آماری به‌تنهایی علت اختلال را اثبات نمی‌کند.</p></div></div>
    </div>;
  }
  else if (page === "censorship") body = <div className="stack">
    <div className="intro page-intro">
      <small><ShieldAlert size={14}/> بررسی دسترسی وب‌سایت‌ها</small>
      <h2>وضعیت دسترسی به وب‌سایت‌ها</h2>
      <p>هم نتیجهٔ آزمون‌های واقعی از داخل ایران را می‌بینی، هم دامنه‌هایی را که پژوهشگران برای آزمایش پیشنهاد کرده‌اند. پیشنهاد برای آزمایش، به معنی فیلتر بودن نیست.</p>
    </div>
    <div className="metrics">
      <Stat icon={Globe2} label="دامنه‌های دارای نتیجه" value={number(censorship.total_domains_observed ?? censorship.domains.filter((item) => item.has_measurements).length, 0)} hint="آزمون واقعی در ۹۰ روز اخیر"/>
      <Stat icon={Cloud} label="دامنه‌های فهرست آزمایش" value={number(censorship.total_test_domains, 0)} hint="نامزد آزمون؛ نه فهرست فیلترها"/>
      <Stat icon={Network} label="شبکه‌های اندازه‌گیری" value={number(censorship.coverage?.probe_networks, 0)} hint="شبکه‌های متمایز با آزمون ثبت‌شده"/>
      <Stat icon={Gauge} label="پوشش شناسهٔ شبکه" value={number(censorship.coverage?.asn_coverage_percent, 1) + "٪"} hint="میزان ثبت شناسهٔ شبکه در آزمون‌ها"/>
      <Stat icon={ShieldCheck} label="دارای شاهد مسدودسازی" value={number(confirmedSites.length, 0)} hint="نشانهٔ روشن در نتیجهٔ OONI"/>
      <Stat icon={AlertTriangle} label="دارای نشانهٔ اختلال" value={number(possibleSites.length, 0)} hint="هنوز فیلتر بودن قطعی نیست"/>
      <Stat icon={Clock3} label="آخرین دریافت" value={censorship.sync?.finished_at ? time(censorship.sync.finished_at, false) : "—"} hint="به‌روزرسانی دوره‌ای"/>
    </div>
    <div className="toolbar">
      <div className="range-tabs">
        {[
          ["confirmed", "شاهد مسدودسازی"],
          ["possible", "نشانهٔ اختلال"],
          ["candidates", "هنوز بررسی‌نشده"],
          ["all", "همه"],
        ].map(([value, label]) => <button key={value} className={siteFilter === value ? "active" : ""} onClick={() => setSiteFilter(value)}>{label}</button>)}
      </div>
      <input className="site-search" type="search" value={siteQuery}
        onChange={(event) => setSiteQuery(event.target.value)}
        placeholder="جست‌وجوی نام دامنه…" aria-label="جست‌وجوی دامنه"/>
    </div>
    {censorship.error && <div className="warning"><AlertTriangle/><div><b>دریافت فهرست با مشکل روبه‌رو شد</b><p>{censorship.error} آخرین دادهٔ ذخیره‌شده، در صورت وجود، همچنان نمایش داده می‌شود.</p></div></div>}
    {censorship.sync && <div className="site-sync-note">
      <span>آخرین همگام‌سازی: {time(censorship.sync.finished_at)}</span>
      <span>وضعیت دریافت: {censorship.sync.status === "success" ? "موفق" : censorship.sync.status === "partial" ? "ناقص" : "ناموفق"}</span>
      <span>نتایج OONI: {number(censorship.sync.records_received, 0)}</span>
      <span>دامنه‌های فهرست آزمایش: {number(censorship.sync.test_list_records_received, 0)}</span>
    </div>}
    {censorship.scope_note && <p className="toolbar-note">{censorship.scope_note}</p>}
    <Panel tag="نتیجهٔ آزمون یا فهرست پژوهشی"
      title={siteFilter === "confirmed" ? "دارای شاهد مسدودسازی" : siteFilter === "possible" ? "دارای نشانهٔ اختلال" : siteFilter === "candidates" ? "نامزدهای آزمون بدون نتیجهٔ تازه" : "همهٔ دامنه‌های قابل بررسی"}
      note="دامنهٔ فهرست پژوهشی فقط برای آزمایش پیشنهاد شده است؛ تا وقتی نتیجهٔ تازه‌ای نباشد وضعیت آن نامشخص است.">
      {filteredDomains.length ? <div className="site-list">{filteredDomains.map((site) =>
        <article className="site-row" key={site.domain}>
          <div className="site-row-main">
            <div className="site-domain-line">
              <b dir="ltr">{site.domain}</b>
              <Badge value={site.candidate_only ? "candidate" : site.confirmed_blocked ? "confirmed" : "possible"} map={{
                confirmed: ["شاهد مسدودسازی", "warn"],
                possible: ["نشانهٔ اختلال", "neutral"],
                candidate: ["هنوز بررسی نشده", "neutral"],
              }}/>
            </div>
            <small>{site.category_label || "دسته‌بندی نشده"} · {site.candidate_only ? "در فهرست پژوهشی؛ بدون نتیجهٔ تازه" : "آخرین آزمون: " + time(site.last_observed_at)}</small>
          </div>
          <div className="site-evidence">
            <span>{site.candidate_only ? "هنوز نتیجهٔ قابل نمایش برای این دامنه ثبت نشده است." : number(site.confirmed_measurements, 0) + " آزمون تأییدشده · " + number(site.anomaly_measurements, 0) + " آزمون غیرعادی · " + number(site.probe_networks, 0) + " شبکه"}</span>
            {site.source_url && <a href={site.source_url} target="_blank" rel="noreferrer">{site.candidate_only ? "منبع فهرست پژوهشی ↗" : "مشاهدهٔ شواهد ↗"}</a>}
          </div>
        </article>
      )}</div> : <Empty
        title={censorship.busy ? "در حال دریافت فهرست" : "دامنه‌ای در این گروه ثبت نشده"}
        note={censorship.error || "با انتخاب گروه دیگر یا جست‌وجوی نام دامنه می‌توانی فهرست را بررسی کنی."}
      />}
    </Panel>
    <div className="notice"><Info size={17}/><div>
      <b>سه وضعیت را با هم اشتباه نگیریم</b>
      <p>«شاهد مسدودسازی» یعنی آزمون OONI نشانهٔ مشخص مسدودسازی را دیده است. «نشانهٔ اختلال» ممکن است از مشکل شبکه یا سرور هم باشد. «هنوز بررسی نشده» یعنی دامنه در فهرست پژوهشی آمده، اما نتیجهٔ تازه‌ای نداریم. هیچ فهرست عمومی، تمام سایت‌های فیلترشده را با قطعیت پوشش نمی‌دهد.</p>
    </div></div>
  </div>;
  else if (page === "intelligence") {
    const intelligence = analysis.intelligence || {};
    const forecast = intelligence.forecast || {};
    const modelSignals = intelligence.signals || [];
    const cause = intelligence.cause_analysis || {};
    const recovery = intelligence.recovery_estimate || {};
    const unavailableProviderCount = (providerData.providers || []).filter((item) => item.available === false).length;
    body = <div className="stack">
      <div className="intro page-intro"><small><BrainCircuit size={14}/> NetGuard Intelligence</small><h2>تحلیل هوشمند و پیش‌بینی روند اینترنت</h2><p>این بخش تغییرات غیرعادی را در چند شاخص پیدا می‌کند، هم‌زمانی شواهد را می‌سنجد و امتداد کوتاه‌مدت روند را نشان می‌دهد. خروجی‌ها هشدار زودهنگام‌اند، نه اعلام قطعی خاموشی.</p></div>
      <div className="metrics">
        <Stat icon={BrainCircuit} label="مدل" value={intelligence.model_name || "در حال آماده‌سازی"} hint={intelligence.model_status_label || "تاریخچهٔ کافی لازم است"}/>
        <Stat icon={Gauge} label="امتیاز نشانه‌های افت" value={forecast.risk_index == null ? "—" : <span dir="rtl" className="risk-score-rtl">{number(forecast.risk_index, 0)} از ۱۰۰</span>} hint="امتیاز آزمایشی؛ نه درصد احتمال اختلال"/>
        <Stat icon={Activity} label="شاخص‌های آمادهٔ امتیازدهی" value={number(intelligence.trained_signals, 0)} hint={"از " + number(modelSignals.length, 0) + " شاخص؛ دادهٔ تازه و تاریخچهٔ کافی لازم است"}/>
        <Stat icon={AlertTriangle} label="رفتارهای غیرمعمول" value={number(modelSignals.filter((item) => item.is_anomaly).length, 0)} hint="نیازمند بررسی چندمنبعی"/>
        <Stat icon={Clock3} label="افق‌های برآورد" value="۱۵، ۳۰، ۶۰ دقیقه" hint="امتداد آزمایشی روند"/>
      </div>
      <Panel tag="پیش‌بینی آزمایشی" title="ریسک افت در افق ۳۰ دقیقه" note={forecast.note || "برآورد پس از دریافت دادهٔ کافی نمایش داده می‌شود."}>
        {forecast.available ? <div className={"risk-callout " + (forecast.risk_level || "unknown")}><div><small>امتیاز نشانه‌های افت با تأیید هم‌زمان دو شاخص اصلی</small><strong dir="rtl" className="risk-score-rtl">{number(forecast.risk_index, 0)} از ۱۰۰</strong><span>{forecast.risk_label}</span></div><p>این امتیاز فقط وقتی منتشر می‌شود که هر دو شاخص اصلی دادهٔ تازه و نمونهٔ کافی داشته باشند؛ صفر نیز به معنی نبود خطر قطعی نیست.</p></div> : <div className="notice"><Info size={17}/><div><b>امتیاز ترکیبی ملی فعلاً قابل انتشار نیست</b><p>{forecast.note || "برای جمع‌بندی هم‌زمان، دادهٔ تازه و نمونهٔ کافی از هر دو شاخص اصلی لازم است."} بااین‌حال، هر شاخصی که به‌تنهایی شرایط محاسبه را داشته باشد، جداگانه در پایین نمایش داده می‌شود.</p></div></div>}
        {(forecast.components || []).some((item) => item.available) ? <>
          <div className="forecast-grid">{forecast.components.filter((item) => item.available).map((item) => <article key={item.signal}>
            <small>{item.signal === "bgp" ? "دیدپذیری مسیرهای اینترنت (BGP)" : "پاسخ‌گویی شبکه در پایش فعال"}</small>
            <div className="forecast-horizons">{(item.horizon_projections || []).map((point) => <div key={point.minutes}><small>{number(point.minutes, 0)} دقیقه</small><b className={point.projected_change_percent < 0 ? "negative" : "positive"}>{point.projected_change_percent > 0 ? "+" : ""}{number(point.projected_change_percent)}٪</b><span>مقدار تخمینی: {number(point.projected_value)}</span></div>)}</div>
            <span>آخرین مشاهده: {number((item.observation_age_seconds || 0) / 60, 0)} دقیقه قبل · مقدار فعلی {number(item.current_value)}</span>
            <span>تغییر مشاهده‌شده در ۳۰ دقیقه: {number(item.projected_change_30m_percent)}٪ · امتیاز ناهنجاری: {item.anomaly_score == null ? "—" : number(item.anomaly_score, 2)}</span>
          </article>)}</div>
          <p className="forecast-method-note">این مقادیر امتداد خطی روند دو پنجرهٔ ۳۰ دقیقه‌ای هستند، نه احتمال آماری یا پیش‌بینی قطعی. خروجی تک‌شاخصی جای امتیاز ترکیبی دو شاخص را نمی‌گیرد.</p>
        </> : <Empty title="برای هیچ شاخصی برآورد مستقل آماده نیست" note="برای هر شاخص باید دادهٔ تازه و نمونهٔ کافی در دو پنجرهٔ ۳۰ دقیقه‌ای موجود باشد."/>}
      </Panel>
      <Panel tag="تحلیل شواهد" title="فرضیه‌های علت احتمالی" note={cause.scope_note || "این تحلیل علت قطعی اختلال را تعیین نمی‌کند."}>
        <div className="cause-card">
          <div className="cause-heading">
            <div><small>فرضیهٔ اصلی</small><b>{cause.hypothesis_label || "دادهٔ کافی موجود نیست"}</b></div>
            <span className={"cause-strength " + (cause.evidence_strength || "none")}>{cause.evidence_strength_label || "شواهد ناکافی"}</span>
          </div>
          <p>{cause.description || "برای تحلیل علت به هم‌زمانی داده‌های چند منبع نیاز است."}</p>
          <div className="cause-signals">{(cause.observed_changes || []).map((item) => <span key={item.source_id}><b>{item.display_name}</b>{item.status === "ready" && item.change_percent != null ? number(item.change_percent) + "٪ در ۳۰ دقیقه" : "دادهٔ هم‌زمان کافی نیست"}</span>)}</div>
          {cause.alternative_explanations?.length ? <div className="cause-alternatives"><small>توضیح‌های جایگزین برای بررسی</small><ul>{cause.alternative_explanations.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
        </div>
      </Panel>
      <Panel tag="بازیابی و مدت رخداد" title="تخمین زمان بازگشت به وضعیت عادی" note={recovery.note || "برآورد زمان بازیابی فعلاً منتشر نمی‌شود."}>
        <Empty title="هنوز قابل برآورد نیست" note="برای تخمین معتبر، باید رخدادهای تاریخیِ تأییدشده همراه با زمان شروع، پایان و شدت در اختیار مدل باشد. تا قبل از آن عدد زمان بازیابی نمایش داده نمی‌شود."/>
      </Panel>
      <div className="plain-explanation"><b>این مدل چه فایده‌ای دارد؟</b><p>مدل رفتار معمول هر شاخص را از روی داده‌های قبلی یاد می‌گیرد. اگر رفتار تازه با گذشته فرق زیادی داشته باشد، آن را برای بررسی علامت می‌زند؛ این علامت به‌تنهایی معنی اختلال اینترنت نیست.</p></div>
      {modelSignals.some((item) => item.is_anomaly) && <div className="notice"><Info size={17}/><div><b>یک شاخص کمکی رفتار غیرمعمولی نشان داده است</b><p>این یافته برای بررسی بیشتر نگه داشته می‌شود؛ اما چون به‌تنهایی افت مسیر یا پاسخ‌گویی شبکه را ثابت نمی‌کند، مستقیماً به امتیاز نشانه‌های افت اضافه نمی‌شود.</p></div></div>}
      <Panel tag="خروجی قابل فهم مدل‌ها" title="کدام شاخص رفتار متفاوتی نشان داده است؟" note="هر شاخص با سابقهٔ خودش سنجیده می‌شود. علامت غیرعادی فقط یک هشدار برای بررسی است و به‌تنهایی اختلال اینترنت را ثابت نمی‌کند.">
        {modelSignals.length ? <div className="ai-signal-grid">{modelSignals.map((item) => <article key={item.source_id}><div><b>{item.display_name}</b><Badge value={item.status} map={{ready: [item.is_anomaly ? "رفتار غیرمعمول" : "در محدودهٔ معمول", item.is_anomaly ? "warn" : "good"], collecting_history: ["در حال یادگیری", "neutral"], stale_data: ["داده قدیمی", "neutral"]}}/></div><p>{item.interpretation}</p><small>{number(item.sample_count, 0)} نمونهٔ معتبر · {number(item.training_samples, 0)} نمونهٔ آموزشی · آخرین مشاهده {item.observation_age_seconds == null ? "نامشخص" : number(item.observation_age_seconds / 60, 0) + " دقیقه قبل"}</small></article>)}</div> : <Empty title="هنوز تاریخچهٔ کافی نداریم" note="مدل تا زمان جمع شدن دادهٔ واقعی، نتیجهٔ ساختگی تولید نمی‌کند."/>}
      </Panel>
      <details className="technical-details"><summary>جزئیات فنی مدل و امتیازهای هر شاخص</summary>
      <Panel tag="مدل یادگیری ماشین" title="امتیاز و تشخیص ناهنجاری به تفکیک شاخص" note={intelligence.method_note || "برای هر شاخص یک مدل مستقل و بدون‌نظارت اجرا می‌شود؛ امتیازها احتمال قطعی اختلال نیستند."}>
        <div className="ml-spec-grid">
          <article><small>الگوریتم</small><b>{intelligence.model_name || "Hybrid Isolation Forest"}</b></article>
          <article><small>تعداد درخت‌ها</small><b>۶۴</b></article>
          <article><small>حداکثر نمونه در هر درخت</small><b>۱۲۸</b></article>
          <article><small>حداقل تاریخچهٔ خام</small><b>۴۵ مشاهده</b></article>
          <article><small>حداقل ویژگی آموزشی</small><b>۳۲ نمونه</b></article>
          <article><small>آستانهٔ ناهنجاری</small><b>۰٫۶۵ از ۱</b></article>
        </div>
        <p className="ml-feature-note">ویژگی‌های مدل: لگاریتم سطح سیگنال، نرخ تغییر نرمال‌شده با فاصلهٔ زمانی واقعی و فاصله از خط مبنای مقاوم یک‌ساعته (MAD). امتیاز نهایی هر شاخص ترکیبی از Isolation Forest و انحراف مقاوم است.</p>
        {modelSignals.length ? <div className="ml-list">{modelSignals.map((item) => <article className={"ml-row " + (item.is_anomaly ? "is-anomaly" : "")} key={item.source_id}>
          <div className="ml-row-head">
            <div><b>{item.display_name}</b><small dir="ltr">{item.signal} · مدل مستقل برای این شاخص</small></div>
            <div className="ml-score-wrap"><span className={item.is_anomaly ? "ml-score anomaly" : "ml-score"}>{item.score == null ? "—" : number(item.score, 3) + " / ۱"}</span><small>امتیاز ناهنجاری</small></div>
          </div>
          {item.score != null && <div className="ml-score-track" role="img" aria-label={"امتیاز ناهنجاری " + number(item.score, 3) + " از ۱"}><span style={{width: (Math.max(0, Math.min(1, Number(item.score))) * 100) + "%"}}/></div>}
          <p>{item.interpretation}</p>
          <div className="ml-score-breakdown">
            <div><small>امتیاز Isolation Forest</small><b>{item.isolation_forest_score == null ? "—" : number(item.isolation_forest_score, 3)}</b></div>
            <div><small>امتیاز انحراف مقاوم</small><b>{item.robust_deviation_score == null ? "—" : number(item.robust_deviation_score, 3)}</b></div>
            <div><small>آستانهٔ تشخیص</small><b>۰٫۶۵</b></div>
          </div>
          <div className="ml-meta"><span>وضعیت: {item.status_label}</span><span>تاریخچه: {number(item.sample_count, 0)} نمونه</span><span>ویژگی آموزشی: {number(item.training_samples, 0)}</span><span>فاصلهٔ نمونه‌برداری: {number((item.expected_interval_seconds || 0) / 60, 0)} دقیقه</span><span>آخرین مشاهده: {item.observation_age_seconds == null ? "نامشخص" : number(item.observation_age_seconds / 60, 0) + " دقیقه قبل"}</span><span>ویژگی غالب: {item.dominant_feature_label || "نامشخص"}</span></div>
        </article>)}</div> : <Empty title="امتیاز قابل نمایش نیست" note="برای هر شاخص باید تاریخچهٔ معتبر و تازه کافی باشد؛ در غیر این صورت امتیاز عمداً خالی می‌ماند."/>}
      </Panel>
      <div className="notice"><Info size={17}/><div><b>مرز علمی مدل</b><p>این مدل رفتار غیرعادی را پیدا می‌کند، نه احتمال قطعی خاموشی را. امتیازهای مدل زمانی به احتمال واقعی تبدیل می‌شوند که با رخدادهای تأییدشده آزمایش و کالیبره شده باشند.</p></div></div>
      </details>
      {providerData.is_stale && <div className="warning"><AlertTriangle/><div><b>اطلاعات وضعیت جهانی قدیمی است</b><p>آخرین snapshot در {time(providerData.snapshot_at)} ثبت شده؛ ممکن است وضعیت رسمی ارائه‌دهندگان از آن زمان تغییر کرده باشد.</p></div></div>}
      {providerData.snapshot_status === "partial" && <div className="notice"><Info size={17}/><div><b>دادهٔ وضعیت جهانی کامل نیست</b><p>{number(unavailableProviderCount, 0)} ارائه‌دهنده در آخرین بررسی پاسخ معتبر نداده‌اند و با وضعیت «نامشخص» نمایش داده می‌شوند. این موضوع به‌تنهایی نشانهٔ اختلال اینترنت ایران یا خرابی آن سرویس‌ها نیست.</p></div></div>}
      <Panel tag="وضعیت سرویس‌های هوش مصنوعی" title="دسترسی جهانی به ارائه‌دهندگان مدل‌ها" note="این اطلاعات از صفحات رسمی وضعیت شرکت‌ها می‌آید و وضعیت دسترسی به آن‌ها از داخل ایران را به‌تنهایی ثابت نمی‌کند.">
        <div className="provider-grid">{(providerData.providers || []).filter((item) => item.group === "ai").map((item) => <ProviderCard key={item.id} item={item}/>)}</div>
      </Panel>
    </div>;
  }
  else if (page === "providers") {
    const providerList = providerData.providers || [];
    const unavailableProviderCount = providerList.filter((item) => item.available === false).length;
    const infra = providerList.filter((item) => item.group === "infrastructure");
    const developer = providerList.filter((item) => item.group === "developer");
    const cloudflare = providerList.find((item) => item.id === "cloudflare");
    const globalNodes = (cloudflare?.technical_components || []).filter((item) => item.name && item.name.includes(" - ("));
    const globalIssues = globalNodes.filter((item) => item.status !== "operational" && item.status !== "unknown");
    body = <div className="stack">
      <div className="intro page-intro"><small><Server size={14}/> زیرساخت و مراکز داده</small><h2>مراکز دادهٔ ایران و خارج از ایران</h2><p>این صفحه موجودی عمومی مراکز داخل کشور را از وضعیت نقاط حضور و زیرساخت جهانی جدا می‌کند. «ثبت‌شده» با «پایش زنده و سالم» یکی نیست.</p></div>
      <div className="metrics">
        <Stat icon={Server} label="مراکز و محل‌های میزبانی ایران" value={number(datacenterData.total_sites, 0)} hint="رکوردهای مستند و نامزدهای دایرکتوری"/>
        <Stat icon={Activity} label="مراکز ایران با پایش زنده" value={number(datacenterData.directly_monitored, 0)} hint="اندازه‌گیری مستقیم NetGuard"/>
        <Stat icon={Globe2} label="نقاط حضور Cloudflare در جهان" value={number(cloudflare?.data_center_count, 0)} hint="مؤلفه‌های مکان‌محور در صفحهٔ رسمی"/>
        <Stat icon={AlertTriangle} label="مکان‌های جهانی غیرعادی" value={number(globalIssues.length, 0)} hint="وضعیت اعلام‌شدهٔ سرویس، نه از داخل ایران"/>
      </div>
      {providerData.error && <div className="warning"><AlertTriangle/><div><b>دریافت وضعیت جهانی با مشکل روبه‌رو شد</b><p>{providerData.error}</p></div></div>}
      {providerData.is_stale && <div className="warning"><AlertTriangle/><div><b>اطلاعات وضعیت جهانی قدیمی است</b><p>آخرین snapshot در {time(providerData.snapshot_at)} ثبت شده؛ ممکن است وضعیت رسمی ارائه‌دهندگان از آن زمان تغییر کرده باشد.</p></div></div>}
      {providerData.snapshot_status === "partial" && <div className="notice"><Info size={17}/><div><b>دادهٔ وضعیت جهانی کامل نیست</b><p>{number(unavailableProviderCount, 0)} ارائه‌دهنده در آخرین بررسی پاسخ معتبر نداده‌اند و با وضعیت «نامشخص» نمایش داده می‌شوند. این موضوع به‌تنهایی نشانهٔ اختلال اینترنت ایران یا خرابی آن سرویس‌ها نیست.</p></div></div>}
      <Panel tag="داخل ایران" title="مراکز داده و مکان‌های میزبانی ایران" note={datacenterData.scope_note || "فهرست مراکز ثبت‌شده در منابع عمومی؛ وضعیت عملیاتی فقط با اندازه‌گیری مستقیم قابل تأیید است."}>
        {datacenterData.error && <div className="warning"><AlertTriangle/><div><b>دریافت فهرست ناموفق بود</b><p>{datacenterData.error}</p></div></div>}
        <div className="metrics">
          <Stat icon={Server} label="مکان‌های ثبت‌شده" value={number(datacenterData.total_sites, 0)} hint="رکوردهای با سطح اعتبار متفاوت"/>
          <Stat icon={Activity} label="دارای پایش مستقیم" value={number(datacenterData.directly_monitored, 0)} hint="فعلاً نقاطی که NetGuard مستقلاً می‌سنجد"/>
          <Stat icon={Clock3} label="آخرین snapshot" value={time(datacenterData.snapshot_at, false)} hint="زمان ذخیرهٔ فهرست"/>
        </div>
        {datacenterData.sites?.length ? <div className="table-wrap"><table>
          <thead><tr><th>مرکز / محل میزبانی</th><th>اپراتور</th><th>شهر</th><th>اعتبار منبع</th><th>وضعیت واقعی</th><th>منبع</th></tr></thead>
          <tbody>{datacenterData.sites.map((site) => <tr key={site.site_id}>
            <td><b>{site.name}</b><small>{site.notes}</small></td>
            <td>{site.operator || "نامشخص"}</td>
            <td>{[site.city, site.province].filter(Boolean).join("، ") || "نامشخص"}</td>
            <td>{({operator_documented: "مستند اپراتور", operator_listed: "فهرست اپراتور", third_party_listed: "منبع مستقل", directory_candidate: "نامزد دایرکتوری"})[site.evidence_level] || "نامشخص"}</td>
            <td><Badge value="unknown"/><small>{site.status_label || "پایش زنده وجود ندارد"}</small></td>
            <td><a href={site.source_url} target="_blank" rel="noreferrer">{site.source_name} ↗</a></td>
          </tr>)}</tbody>
        </table></div> : <Empty title="فهرست دیتاسنترهای ایران هنوز در دسترس نیست" note={datacenterData.error || "پس از ثبت inventory، مراکز اینجا نمایش داده می‌شوند."}/>}
        <div className="notice"><Info size={17}/><div><b>این فهرست، وضعیت روشن/خاموش مراکز نیست</b><p>برای سنجش سلامت هر مرکز باید از داخل ایران یا از چند نقطهٔ مستقل به آن آزمون بفرستیم. تا وقتی چنین probeای نداشته باشیم، وضعیت عملیاتی را نامشخص نگه می‌داریم و از روی وب‌سایت اپراتور حکم نمی‌دهیم.</p><p><a href="https://covered.ir/en/sites" target="_blank" rel="noreferrer">فهرست نقاط پایش مستقل Covered.ir ↗</a> <small>منبع بیرونی است و هنوز به پایش مستقیم NetGuard تبدیل نشده.</small></p></div></div>
      </Panel>
      <Panel tag="خارج از ایران" title="نقاط حضور و مراکز شبکهٔ جهانی" note="Cloudflare مکان‌های شبکهٔ خود را در صفحهٔ وضعیت منتشر می‌کند. این داده فهرست کامل تمام مراکز دادهٔ جهان نیست و محل فیزیکی همهٔ سرورها را نیز مشخص نمی‌کند.">
        {cloudflare ? <ProviderCard item={cloudflare}/> : <Empty title="اطلاعات جهانی هنوز دریافت نشده"/>}
        {globalNodes.length ? <div className="table-wrap global-node-table"><table>
          <thead><tr><th>شهر / نقطهٔ حضور</th><th>وضعیت رسمی</th><th>آخرین به‌روزرسانی مؤلفه</th></tr></thead>
          <tbody>{globalNodes.slice(0, 80).map((item) => <tr key={item.name}><td>{item.name}</td><td><Badge value={item.status} map={providerStatusMap}/></td><td>{time(item.updated_at)}</td></tr>)}</tbody>
        </table></div> : <Empty title="فهرست مکان‌های جهانی موجود نیست" note="صفحهٔ رسمی Cloudflare هنوز اجزای مکان‌محور قابل نمایش ارائه نکرده است."/>}
        <div className="notice"><Info size={17}/><div><b>تفاوت با وضعیت اینترنت ایران</b><p>وضعیت عادی در یک مرکز خارجی فقط سلامت اعلام‌شدهٔ همان شرکت را نشان می‌دهد. برای فهمیدن اینکه کاربران ایران به آن مرکز یا سرویس دسترسی دارند، باید آزمون اتصال از داخل ایران داشته باشیم.</p></div></div>
      </Panel>
      <Panel tag="سرویس‌های جهانی" title="زیرساخت ابری و میزبانی" note="اطلاعات از صفحه‌های رسمی جهانی است، نه آزمون اتصال از داخل ایران. وضعیت کلی صفحه و وضعیت مؤلفه‌های دارای مشکل جداگانه نمایش داده می‌شوند؛ این بخش فهرست مراکز داده نیست.">
        <div className="provider-grid">{infra.filter((item) => item.id !== "cloudflare").map((item) => <ProviderCard key={item.id} item={item}/>)}</div>
      </Panel>
      <Panel tag="ابزارهای توسعه" title="سرویس‌های کدنویسی و همکاری" note="وضعیت اعلام‌شدهٔ جهانی سرویس‌ها؛ برای سنجش دسترسی از داخل ایران به آزمون اتصال مستقل نیاز است.">
        <div className="provider-grid">{developer.map((item) => <ProviderCard key={item.id} item={item}/>)}</div>
      </Panel>
      <div className="toolbar-note">آخرین بررسی جهانی: {time(providerData.checked_at)} · فهرست داخل ایران: {time(datacenterData.snapshot_at)} · snapshotها هر ۱۰ دقیقه ذخیره می‌شوند و بازدید صفحه باعث جمع‌آوری تازه نمی‌شود.</div>
    </div>;
  }
  else if (page === "signals") body = <div className="stack">
    <div className="intro page-intro"><small><Signal size={14}/> نشانه‌های وضعیت شبکه</small><h2>این نمودارها چه می‌گویند؟</h2><p>هر نمودار یک بخش از وضعیت اینترنت را نشان می‌دهد. توضیح سادهٔ آن بالای آمار قرار دارد و جزئیات تخصصی همچنان در دسترس است.</p></div>
    <div className="toolbar">
      <div className="range-tabs" aria-label="بازهٔ زمانی">
        {[[24, "۲۴ ساعت"], [72, "۳ روز"], [168, "۷ روز"]].map(([hours, label]) => <button key={hours} className={windowHours === hours ? "active" : ""} onClick={() => setWindowHours(hours)}>{label}</button>)}
      </div>
      <span className="toolbar-note">{number(data.observations.length, 0)} مشاهدهٔ دریافتی</span>
    </div>
    {signals.length ? signals.map((signal) => {
      const rows = groups[signal.source_id] || [];
      const trend = signal.change_percent;
      return <Panel key={signal.source_id} className="signal-panel" tag={signal.provider + " · " + signal.signal} title={signal.display_name} note={signal.description}>
        <div className="signal-card-head"><Badge value={signal.display_freshness_status || signal.freshness_status}/><span>{signal.data_state_label}</span><a href={signal.source_url} target="_blank" rel="noreferrer">مستندات منبع ↗</a></div>
        <div className="plain-explanation"><b>{signal.plain_title || "این شاخص چه می‌گوید؟"}</b><p>{signal.plain_explanation || signal.description}</p>{signal.trend_1h_label && <small>روند یک ساعت اخیر: {signal.trend_1h_label}{signal.trend_1h_change_percent == null ? "" : " · " + number(signal.trend_1h_change_percent) + "٪"}</small>}</div>
        <div className="signal-stats">
          <div><small>آخرین مقدار</small><b>{number(signal.latest_value)}</b><em>{signal.unit}</em></div>
          <div><small>خط مبنای آماری</small><b>{number(signal.baseline_value)}</b><em>میانهٔ پنجرهٔ قبلی</em></div>
          <div><small>تغییر اخیر</small><b className={trend == null ? "" : trend < 0 ? "negative" : "positive"}>{trend == null ? "—" : (trend > 0 ? "+" : "") + number(trend) + "٪"}</b><em>{signal.current_anomaly ? "انحراف شناسایی شده" : "نسبت به خط مبنا"}</em></div>
          <div><small>تعداد نمونه</small><b>{number(signal.sample_count, 0)}</b><em>رکورد معتبر در بازه</em></div>
        </div>
        <div className="chart-heading"><b>روند اندازه‌گیری</b><span>مقیاس مستقل · {number(rows.length, 0)} نقطه</span></div>
        <Chart rows={rows}/>
        <div className="signal-foot">
          <span>کمینه: <b>{number(signal.minimum_value)}</b></span><span>میانه: <b>{number(signal.median_value)}</b></span><span>بیشینه: <b>{number(signal.maximum_value)}</b></span>
          <span>فاصلهٔ نمونه‌گیری: <b>{number((signal.expected_interval_seconds || (signal.signal === "ping-slash24" ? 600 : 300)) / 60, 0)} دقیقه</b></span>
          <span>پوشش بازه: <b>{number(signal.data_quality?.sample_coverage_percent, 1)}٪</b></span>
          <span>آخرین جمع‌آوری: <b>{time(signal.last_collected_at)}</b></span>
          {signal.last_run_error_code && <span>خطای آخرین اجرا: <b>{signal.last_run_error_code}</b></span>}
        </div>
        {signal.current_anomaly && <div className="signal-alert"><AlertTriangle size={15}/> تغییر غیرعادی در این سیگنال ثبت شده؛ برای تعیین اهمیت شبکه‌ای به شواهد مکمل نیاز است.</div>}
      </Panel>;
    }) : <Empty title="سیگنالی برای تحلیل موجود نیست" note="اتصال منبع داده یا پاسخ API را بررسی کنید."/>}
  </div>;
  else if (page === "events") body = <div className="stack">
    <div className="intro page-intro"><small><AlertTriangle size={14}/> دفتر رخدادها</small><h2>رخدادهای شناسایی‌شده</h2><p>انحراف آماری، تأخیر داده و خطای جمع‌آوری جدا هستند. هر مورد وضعیت زمانی مستقل دارد: در جریان، پایان‌یافته یا سابقهٔ تاریخی. «مشکوک» نیز درجهٔ تأیید شواهد است، نه وضعیت زمانی رخداد.</p></div>
    <div className="metrics">
      <Stat icon={AlertTriangle} label="رخدادهای جاری" value={number(events.filter((event) => event.lifecycle === "active").length, 0)} hint="ناهنجاری با دادهٔ تازه"/>
      <Stat icon={Clock3} label="رخدادهای پایان‌یافته" value={number(events.filter((event) => event.lifecycle === "resolved").length, 0)} hint="در تاریخچهٔ بازهٔ انتخابی"/>
      <Stat icon={ShieldAlert} label="شدت بالا یا بحرانی" value={number(events.filter((event) => ["critical", "high"].includes(event.severity)).length, 0)} hint="در کل بازهٔ انتخابی"/>
      <Stat icon={Signal} label="هشدارهای عملیاتی" value={number(events.filter((event) => ["source_delayed", "source_stale", "collector_error"].includes(event.event_type)).length, 0)} hint="تأخیر مشاهده، تازگی داده یا اجرای جمع‌آوری؛ نه رخداد شبکه"/>
    </div>
    <div className="toolbar">
      <div className="range-tabs">
        {[["all","همه"],["critical","بحرانی"],["high","زیاد"],["warning","هشدار"],["info","اطلاع"]].map(([value,label]) => <button key={value} className={eventFilter === value ? "active" : ""} onClick={() => setEventFilter(value)}>{label}</button>)}
      </div>
      <span className="toolbar-note">مرتب‌شده بر اساس زمان رخداد</span>
    </div>
    {filteredEvents.length ? <div className="event-list">{filteredEvents.map((event) => <EventCard key={event.event_id} event={event}/>)}</div>
      : <Empty title={events.length ? "رخدادی با این فیلتر وجود ندارد" : "هنوز رخداد معناداری شناسایی نشده"} note="نبود رخداد ثبت‌شده، سلامت کامل اینترنت را اثبات نمی‌کند؛ پوشش سیگنال‌ها محدود است."/>}
    <div className="notice"><Info size={17}/><div><b>چرا رخدادها تأیید قطعی نیستند؟</b><p>برای تأیید اختلال در سطح کشور، شواهد مستقل، هم‌زمان و پایدار لازم است. هم‌زمانی BGP، پایش فعال و تلسکوپ شبکه فقط قدرت شواهد را افزایش می‌دهد و علت رخداد را به‌تنهایی مشخص نمی‌کند.</p></div></div>
  </div>;
  else if (page === "sources") body = <div className="stack">
    <div className="intro"><small>منابع داده</small><h2>اطلاعات از کجا می‌آید؟</h2><p>این صفحه می‌گوید هر منبع چه چیزی را اندازه می‌گیرد. نام‌های فنی و جزئیات اتصال هم در بخش جداگانه نگه داشته شده‌اند.</p></div>
    <Panel tag="سلامت ورودی" title="وضعیت و تازگی منابع"><SourceTable rows={data.sources}/></Panel>
    <div className="three">
      <article><b>IODA · Georgia Tech</b><p>منبع اصلی سیگنال‌های زیرساختی نسخهٔ نخست.</p><a href="https://api.ioda.inetintel.cc.gatech.edu/v2/docs" target="_blank" rel="noreferrer">مستندات API ↗</a></article>
      <article><b>RouteViews</b><p>شواهد مکمل مسیرها؛ هنوز به خط لوله متصل نشده است.</p><a href="https://www.routeviews.org/" target="_blank" rel="noreferrer">وب‌سایت ↗</a></article>
      <article><b>OONI</b><p>منبع مکمل اندازه‌گیری دسترسی؛ منبع پنج‌دقیقه‌ای نیست.</p><a href="https://measurements.ooni.org/" target="_blank" rel="noreferrer">پرتال داده ↗</a></article>
    </div>
  </div>;
  else body = <div className="stack">
    <div className="intro"><small>روش‌شناسی</small><h2>داده چه می‌گوید و چه چیزی را ثابت نمی‌کند؟</h2><p>شفافیت منبع، زمان، کیفیت و محدودیت‌ها بخشی از محصول است.</p></div>
    <div className="three">
      <article><small>۰۱</small><h3>مشاهدهٔ مستقیم</h3><p>مقدار، زمان و منبعی که مستقیم دریافت و ذخیره شده است.</p></article>
      <article><small>۰۲</small><h3>مشکوک؛ نیازمند بررسی</h3><p>چند نشانهٔ هم‌جهت و مستقل وجود دارد، اما شواهد برای تأیید کافی نیست.</p></article>
      <article><small>۰۳</small><h3>تأییدشده با شواهد مستقل</h3><p>فقط پس از معیارهای مستقل، تکرارپذیر و کنترل کیفیت؛ این وضعیت در نسخهٔ فعلی خودکار صادر نمی‌شود.</p></article>
    </div>
    <Panel tag="قواعد تحلیل" title="اصول غیرقابل مذاکره"><ul className="caveats">
      <li>دادهٔ گم‌شده صفر نیست و به وضعیت سالم تبدیل نمی‌شود.</li>
      <li>زمان مشاهده با زمان جمع‌آوری یکی نیست؛ هر دو ثبت می‌شوند.</li>
      <li>دادهٔ ملی به استان، شهر یا اپراتور تعمیم داده نمی‌شود.</li>
      <li>یک شکست اتصال یا کاهش یک سیگنال علت فیلترینگ، تحریم یا خاموشی را ثابت نمی‌کند.</li>
      <li>مقادیر سیگنال‌هایی با واحد متفاوت، با هم مقایسه یا جمع نمی‌شوند.</li>
      <li>امتیاز شواهد، احتمال کالیبره‌شدهٔ وقوع اختلال نیست.</li>
    </ul></Panel>
  </div>;

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><span><Activity size={22}/></span><div><b>NETGUARD</b><small>پایش اینترنت ایران</small></div></div>
      <label>مرکز پایش</label>
      <nav>{NAV.map(([id, title, Icon]) => <button key={id} className={id === page ? "selected" : ""} onClick={() => setPage(id)}><Icon size={18}/>{title}</button>)}</nav>
      <div className="sidefoot"><i className={attention ? "warn-dot" : ""}/>{number(fresh, 0)} منبع تازه از {number(data.sources.length, 0)}<small>دادهٔ عمومی · بدون تخمین ساختگی</small></div>
    </aside>
    <main>
      <header className="topbar"><div className="topbar-crumb">نت‌گارد <b>/</b> <strong>{current[1]}</strong></div>
        <div className="actions"><span className="scope-label"><i/> ایران · پایش ملی</span><button onClick={() => loadSnapshots(keysForPage)} disabled={isRefreshing}><RefreshCw size={15}/>{isRefreshing ? "در حال دریافت" : "به‌روزرسانی"}</button></div>
      </header>
      <div className="content">
        {data.error && <div className="warning"><AlertTriangle/><div><b>دریافت داده ناموفق بود</b><p>{data.error} دادهٔ ساختگی جایگزین نمی‌شود.</p></div></div>}
        {body}
      </div>
      <footer><span>NetGuard · پایش شواهد عمومی</span><span>بازخوانی خودکار هر ۵ دقیقه · زمان نمایش ایران</span></footer>
    </main>
  </div>;
}