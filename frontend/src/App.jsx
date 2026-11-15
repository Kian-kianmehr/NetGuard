import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDownRight, BookOpen, BrainCircuit, CheckCircle2, CircleHelp,
  Clock3, Database, Gauge, Globe2, Info, Network, RadioTower, RefreshCw, ShieldAlert,
  ShieldCheck, Signal, TrendingDown, TrendingUp
} from "lucide-react";

const NAV = [
  ["overview", "نمای کلی", Globe2],
  ["censorship", "سایت‌های فیلترشده", ShieldAlert],
  ["intelligence", "مدل هوشمند و پیش‌بینی", BrainCircuit],
  ["analysis", "تحلیل وضعیت", Activity],
  ["signals", "سیگنال‌ها", Signal],
  ["events", "رخدادها", AlertTriangle],
  ["sources", "منابع داده", Database],
  ["method", "روش‌شناسی", BookOpen],
];
const API = (import.meta.env.VITE_API_URL || "https://netguard-api-oan9.onrender.com").replace(/\/$/, "");
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
  fresh: ["تازه", "good"], stale: ["قدیمی", "warn"],
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
  signal_anomaly: "انحراف سیگنال",
  source_stale: "تأخیر در داده",
  collector_error: "خطای جمع‌آوری",
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

function PublicAssessment({ summary }) {
  if (!summary) return null;
  const tone = summary.tone || "neutral";
  return <section className={"public-assessment " + tone}>
    <div className="public-assessment-head">
      <div>
        <small>جمع‌بندی ساده · وضعیت فعلی اینترنت ایران</small>
        <h2>{summary.title}</h2>
        <p>{summary.summary}</p>
      </div>
      <span className="public-verdict">{summary.condition_label}</span>
    </div>
    <div className="public-verdict-grid">
      <article>
        <small>آیا نشانهٔ قطع گسترده هست؟</small>
        <b>{summary.outage_label}</b>
        <p>{summary.outage_detail}</p>
      </article>
      <article>
        <small>وضعیت پایداری زیرساخت</small>
        <b>{summary.stability_label}</b>
        <p>این ارزیابی از دو شاخص اصلیِ مسیرهای اینترنت و پاسخ‌گویی شبکه‌ها استفاده می‌کند.</p>
      </article>
      <article>
        <small>کیفیت اینترنت برای کاربران</small>
        <b>{summary.quality_label}</b>
        <p>{summary.quality_detail}</p>
      </article>
      <article>
        <small>روند یک ساعت اخیر</small>
        <b>{summary.trend_label}</b>
        <p>{summary.trend_detail}</p>
      </article>
      <article>
        <small>میزان اطمینان به این جمع‌بندی</small>
        <b>{summary.confidence_label}</b>
        <p>{summary.confidence_detail}</p>
      </article>
    </div>
    <div className="public-explanation">
      <b>این نتیجه از کجا آمده؟</b>
      <ul>{(summary.reasoning || []).map((item) => <li key={item}>{item}</li>)}</ul>
      <p>{summary.scope_note}</p>
    </div>
  </section>;
}


function PublicStatus({ summary, checkedAt }) {
  if (!summary) return <section className="public-status neutral">
    <div><small>وضعیت اینترنت ایران</small><h2>در حال دریافت آخرین وضعیت</h2><p>نتیجهٔ آخرین بررسی در این بخش نمایش داده می‌شود.</p></div>
  </section>;

  const states = {
    stable: ["پایدار", "good", "شاخص‌های اصلی در محدودهٔ معمول هستند و فعلاً نشانه‌ای از اختلال گسترده دیده نمی‌شود."],
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
function SourceTable({ rows = [] }) {
  if (!rows.length) return <Empty title="منبع فعالی در پاسخ API نیست" />;
  return <div className="table-wrap"><table>
    <thead><tr><th>منبع</th><th>تازگی داده</th><th>آخرین مشاهده</th><th>آخرین اجرا</th><th>مقدار آخر</th></tr></thead>
    <tbody>{rows.map((source) => <tr key={source.source_id}>
      <td><b>{source.display_name}</b><small>{source.provider} · {source.signal}</small></td>
      <td><Badge value={source.freshness_status}/></td>
      <td>{time(source.last_observed_at)}<small>{source.observation_age_seconds == null ? "سن داده نامشخص" : number(Math.floor(source.observation_age_seconds / 60), 0) + " دقیقه پیش"}</small></td>
      <td>{time(source.last_run_started_at)}<small>{source.last_run_status || "بدون اجرا"}</small></td>
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
      <div><small>امتیاز شواهد</small><b>{number(event.evidence_score, 0)} از ۱۰۰</b></div>
    </div>
    <div className="event-bottom">
      <div><b>{event.source_name || "NetGuard"}</b><small>{time(event.start_at || event.occurred_at)}{event.end_at && event.end_at !== event.start_at ? " تا " + time(event.end_at) : ""}</small></div>
      <span className={"event-status " + (event.status === "suspected" ? "warn" : "")}>{event.status_label || (event.status === "suspected" ? "مشکوک؛ نیازمند تأیید" : "شناسایی‌شده")}</span>
    </div>
    {event.corroborating_sources?.length > 0 && <div className="corroboration"><ShieldAlert size={14}/> هم‌زمانی با {number(event.corroborating_sources.length, 0)} شاخص مستقل دیگر شناسایی شده است؛ این هم‌زمانی اثبات علت نیست.</div>}
  </article>;
}

export default function App() {
  const [page, setPage] = useState("overview");
  const [windowHours, setWindowHours] = useState(168);
  const [eventFilter, setEventFilter] = useState("all");
  const [siteFilter, setSiteFilter] = useState("all");
  const [siteQuery, setSiteQuery] = useState("");
  const [censorship, setCensorship] = useState({
    domains: [], sync: null, generated_at: null, error: "", busy: true,
  });
  const [data, setData] = useState({
    sources: [], observations: [], analysis: null, events: [],
    generated_at: null, error: "", busy: true,
  });

  const loadCensorship = useCallback(async () => {
    if (!API) {
      setCensorship((value) => ({
        ...value, busy: false, error: "آدرس سرویس داده تنظیم نشده است.",
      }));
      return;
    }
    setCensorship((value) => ({ ...value, busy: true }));
    try {
      const response = await fetch(API + "/api/censorship", {
        headers: { Accept: "application/json" }, cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "دریافت فهرست سایت‌ها ناموفق بود.");
      const observedDomains = Array.isArray(payload.domains) ? payload.domains : [];
      setCensorship({
        ...payload,
        domains: observedDomains,
        scope_note: payload.scope_note || "همهٔ دامنه‌های دارای نتیجهٔ مثبت OONI در بازهٔ نمایش داده‌شده‌اند.",
        error: "",
        busy: false,
      });
    } catch (error) {
      setCensorship((value) => ({
        ...value, busy: false, error: error.message || "فهرست سایت‌ها در دسترس نیست.",
      }));
    }
  }, []);

  const load = useCallback(async () => {
    if (!API) {
      setData((value) => ({ ...value, busy: false, error: "آدرس API در متغیر VITE_API_URL تنظیم نشده است." }));
      return;
    }
    setData((value) => ({ ...value, busy: true }));
    try {
      const response = await fetch(API + "/api/dashboard?hours=" + windowHours, {
        headers: { Accept: "application/json" }, cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "دریافت داده ناموفق بود: " + response.status);
      setData({ ...payload, error: "", busy: false });
    } catch (error) {
      setData((value) => ({ ...value, busy: false, error: error.message || "ارتباط با API برقرار نشد." }));
    }
  }, [windowHours]);

  useEffect(() => {
    let active = true, timer;
    const tick = async () => {
      if (!active) return;
      if (document.visibilityState === "visible") await load();
      if (active) timer = setTimeout(tick, 60000);
    };
    tick();
    return () => { active = false; clearTimeout(timer); };
  }, [load]);

  useEffect(() => {
    loadCensorship();
    const timer = window.setInterval(loadCensorship, 15 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [loadCensorship]);

  const groups = useMemo(() => data.observations.reduce((accumulator, row) => {
    (accumulator[row.source_id] ||= []).push(row);
    return accumulator;
  }, {}), [data.observations]);
  const analysis = data.analysis || {};
  const signals = analysis.signals || [];
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
  const possibleSites = censorship.domains.filter((site) => !site.confirmed_blocked);
  const filteredDomains = useMemo(() => {
    const query = siteQuery.trim().toLowerCase();
    return censorship.domains.filter((site) => {
      const matchesFilter = siteFilter === "all"
        || (siteFilter === "confirmed" && site.confirmed_blocked)
        || (siteFilter === "possible" && !site.confirmed_blocked);
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
    <PublicStatus summary={analysis.public_summary} checkedAt={lastPrimaryObservation}/>
    <div className="hero">
      <div><small>سلامت سامانهٔ پایش · ایران</small><h2>{overall}</h2>
        <p>{number(fresh, 0)} منبع تازه · {number(attention, 0)} منبع قدیمی یا خطادار</p>
        <div className="meta"><span>آخرین مشاهده: {time(data.sources.map((source) => source.last_observed_at).filter(Boolean).sort().at(-1))}</span><span>آخرین دریافت API: {time(data.generated_at)}</span></div>
      </div><div className="orb"><Globe2 size={40}/><b>IR</b></div>
    </div>
    <div className="section-kicker">جزئیات فنی سامانهٔ پایش</div>
    <div className="metrics">
      {[[RadioTower, "منابع ثبت‌شده", data.sources.length], [CheckCircle2, "منابع تازه", fresh], [AlertTriangle, "قدیمی یا خطادار", attention], [Activity, "مشاهدات بازه", data.observations.length]].map(([Icon, label, value]) =>
        <Stat key={label} icon={Icon} label={label} value={number(value, 0)} hint="دادهٔ ثبت‌شده"/>
      )}
    </div>
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
  </>;
  else if (page === "analysis") {
    const AssessmentIcon = assessmentIcon[analysis.assessment] || CircleHelp;
    const tone = assessmentTone[analysis.assessment] || "neutral";
    body = <div className="stack">
      <div className="intro page-intro"><small><Activity size={14}/> گزارش پایش ملی</small><h2>ارزیابی وضعیت شبکه</h2><p>ارزیابی توضیح‌پذیر از رفتار سیگنال‌های ملی، کفایت داده و رخدادهای شناسایی‌شده.</p></div>
      <PublicAssessment summary={analysis.public_summary}/>
      <section className={"analysis-hero " + tone}>
        <div className="analysis-mark"><AssessmentIcon size={27}/></div>
        <div className="analysis-main"><small>ارزیابی فعلی</small><h2>{analysis.assessment_label || "دادهٔ کافی نیست"}</h2><p>{analysis.summary || "پس از دریافت دادهٔ معتبر، تحلیل نمایش داده می‌شود."}</p>
          <div className="analysis-stamp"><span><Clock3 size={13}/> {time(analysis.generated_at || data.generated_at)}</span><span><RadioTower size={13}/> بررسی چندمنبعی</span></div>
        </div>
        <div className="coverage-ring" style={{ "--coverage": (analysis.data_coverage_percent || 0) + "%" }}><b>{number(analysis.data_coverage_percent, 0)}٪</b><small>کفایت داده</small></div>
      </section>
      <div className="metrics">
        <Stat icon={Database} label="منابع قابل استفاده" value={number(analysis.usable_sources, 0) + " / " + number(analysis.total_sources, 0)} hint="تاریخچه کافی و داده تازه"/>
        <Stat icon={AlertTriangle} label="منابع دارای انحراف" value={number(analysis.anomalous_sources, 0)} hint="انحراف از خط مبنای هر سیگنال" tone={analysis.anomalous_sources ? "warn" : "default"}/>
        <Stat icon={RadioTower} label="منابع تازه" value={number(analysis.fresh_sources, 0)} hint="بر اساس زمان مشاهده"/>
        <Stat icon={Activity} label="رخدادهای پنجره" value={number(analysis.events_count, 0)} hint="رخدادهای شناسایی‌شده"/>
      </div>
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
      <small><ShieldAlert size={14}/> پایش دسترسی وب‌سایت‌ها</small>
      <h2>وب‌سایت‌های فیلترشده</h2>
      <p>بر پایهٔ آزمون‌های Web Connectivity از داخل ایران در داده‌های ۹۰ روز اخیر OONI.</p>
    </div>
    <div className="metrics">
      <Stat icon={Globe2} label="دامنه‌های مشاهده‌شده" value={number(censorship.total_domains_observed ?? censorship.domains.length, 0)} hint="همهٔ نتایج مثبت OONI در ۹۰ روز"/>
      <Stat icon={Network} label="شبکه‌های اندازه‌گیری" value={number(censorship.coverage?.probe_networks, 0)} hint="شبکه‌های متمایز ثبت‌شده"/>
      <Stat icon={ShieldCheck} label="مسدودیت تأییدشده" value={number(confirmedSites.length, 0)} hint="دارای نشانهٔ تأییدشدهٔ OONI"/>
      <Stat icon={AlertTriangle} label="نیازمند بررسی" value={number(possibleSites.length, 0)} hint="فقط دارای ناهنجاری در آزمون"/>
      <Stat icon={Clock3} label="آخرین دریافت" value={censorship.sync?.finished_at ? time(censorship.sync.finished_at, false) : "—"} hint="به‌روزرسانی دوره‌ای"/>
    </div>
    <div className="toolbar">
      <div className="range-tabs">
        {[
          ["confirmed", "تأییدشده"],
          ["possible", "نشانهٔ اختلال"],
          ["all", "همه"],
        ].map(([value, label]) => <button key={value} className={siteFilter === value ? "active" : ""} onClick={() => setSiteFilter(value)}>{label}</button>)}
      </div>
      <input
        className="site-search"
        type="search"
        value={siteQuery}
        onChange={(event) => setSiteQuery(event.target.value)}
        placeholder="جست‌وجوی دامنه…"
        aria-label="جست‌وجوی دامنه"
      />
    </div>
    {censorship.error && <div className="warning"><AlertTriangle/><div><b>دریافت فهرست با مشکل روبه‌رو شد</b><p>{censorship.error} آخرین دادهٔ ذخیره‌شده، در صورت وجود، همچنان نمایش داده می‌شود.</p></div></div>}
    {censorship.sync && <div className="site-sync-note">
      <span>آخرین همگام‌سازی: {time(censorship.sync.finished_at)}</span>
      <span>وضعیت دریافت: {censorship.sync.status === "success" ? "موفق" : censorship.sync.status === "partial" ? "ناقص" : "ناموفق"}</span>
      <span>رکوردهای دریافتی: {number(censorship.sync.records_received, 0)}</span>
    </div>}
    {censorship.scope_note && <p className="toolbar-note">{censorship.scope_note}</p>}
    <Panel tag="نتایج آزمون‌های OONI" title={siteFilter === "confirmed" ? "مسدودیت‌های تأییدشده" : siteFilter === "possible" ? "موارد دارای نشانهٔ اختلال" : "همهٔ دامنه‌ها"} note="هر ردیف به آزمون ثبت‌شده از داخل ایران متصل است؛ نبود یک دامنه در این فهرست به معنی دسترسی آزاد نیست.">
      {filteredDomains.length ? <div className="site-list">{filteredDomains.map((site) =>
        <article className="site-row" key={site.domain}>
          <div className="site-row-main">
            <div className="site-domain-line">
              <b dir="ltr">{site.domain}</b>
              <Badge value={site.confirmed_blocked ? "confirmed" : "possible"} map={{
                confirmed: ["مسدودیت تأییدشده", "warn"],
                possible: ["نشانهٔ اختلال", "neutral"],
              }}/>
            </div>
            <small>{site.category_code ? "دسته: " + site.category_code + " · " : ""}آخرین آزمون: {time(site.last_observed_at)} · {number(site.probe_networks, 0)} شبکهٔ ثبت‌کننده · {number(site.measurement_count, 0)} اندازه‌گیری</small>
          </div>
          <div className="site-evidence">
            <span>{number(site.confirmed_measurements, 0)} آزمون تأییدشده · {number(site.anomaly_measurements, 0)} آزمون غیرعادی</span>
            {site.source_url && <a href={site.source_url} target="_blank" rel="noreferrer">مشاهدهٔ شواهد ↗</a>}
          </div>
        </article>
      )}</div> : <Empty
        title={censorship.busy ? "در حال دریافت فهرست" : "دامنه‌ای در این گروه ثبت نشده"}
        note={censorship.error || "نتایج آزمون‌های موجود در بازهٔ انتخابی پس از همگام‌سازی نمایش داده می‌شوند."}
      />}
    </Panel>
    <div className="notice"><Info size={17}/><div>
      <b>تفاوت مسدودیت تأییدشده با نشانهٔ اختلال</b>
      <p>OONI زمانی یک وب‌سایت را «تأییدشده» علامت می‌زند که اثر انگشت صفحهٔ مسدودسازی یا نشانی شناخته‌شدهٔ فیلترینگ شناسایی شود. ناهنجاری به‌تنهایی اثبات فیلترینگ نیست و ممکن است مثبت کاذب باشد. نتایج به شبکه‌هایی محدود است که در آن‌ها آزمون انجام شده است.</p>
    </div></div>
  </div>;
  else if (page === "intelligence") {
    const intelligence = analysis.intelligence || {};
    const forecast = intelligence.forecast || {};
    const modelSignals = intelligence.signals || [];
    body = <div className="stack">
      <div className="intro page-intro"><small><BrainCircuit size={14}/> تحلیل یادگیری ماشین</small><h2>مدل هوشمند و برآورد کوتاه‌مدت</h2><p>مدل بدون‌نظارت، رفتار هر سیگنال را با تاریخچهٔ خودش مقایسه می‌کند؛ برآورد آینده از نتیجهٔ قطعی شبکه جداست.</p></div>
      <div className="metrics">
        <Stat icon={BrainCircuit} label="مدل" value={intelligence.model_name || "در حال آماده‌سازی"} hint={intelligence.model_status_label || "تاریخچهٔ کافی لازم است"}/>
        <Stat icon={Gauge} label="شاخص ریسک ۳۰ دقیقه" value={forecast.risk_index == null ? "—" : number(forecast.risk_index, 0) + " / ۱۰۰"} hint={forecast.risk_label || "فعلاً برآوردی موجود نیست"}/>
        <Stat icon={Activity} label="شاخص‌های آموزش‌دیده" value={number(intelligence.trained_signals, 0)} hint="مدل جداگانه برای هر شاخص"/>
        <Stat icon={Clock3} label="افق برآورد" value="۳۰ دقیقه" hint="روند کوتاه‌مدت"/>
      </div>
      <Panel tag="پیش‌بینی آزمایشی" title="ریسک افت در افق ۳۰ دقیقه" note={forecast.note || "برآورد پس از دریافت دادهٔ کافی نمایش داده می‌شود."}>
        {forecast.available ? <>
          <div className={"risk-callout " + (forecast.risk_level || "unknown")}><div><small>شاخص ریسک آزمایشی</small><b>{number(forecast.risk_index, 0)}<em> / ۱۰۰</em></b><span>{forecast.risk_label}</span></div><p>این عدد احتمال وقوع اختلال نیست؛ شاخصی ترکیبی برای اولویت‌بندی بررسی روند دو سیگنال اصلی است.</p></div>
          <div className="forecast-grid">{forecast.components.map((item) => <article key={item.signal}><small>{item.signal === "bgp" ? "دیدپذیری مسیرهای اینترنت (BGP)" : "پاسخ‌گویی شبکه‌ها (Ping)"}</small><b>{number(item.projected_change_30m_percent)}٪</b><span>تغییر برآوردی در ۳۰ دقیقهٔ آینده · مقدار فعلی {number(item.current_value)}</span><span>مقدار برآوردی {number(item.projected_value_30m)} · امتیاز ناهنجاری {item.anomaly_score == null ? "—" : number(item.anomaly_score, 2)}</span></article>)}</div>
        </> : <Empty title="هنوز برآورد هم‌زمان ممکن نیست" note={forecast.note || "برای هر دو شاخص اصلی باید تاریخچهٔ معتبر بیشتری جمع شود."}/>}
      </Panel>
      <Panel tag="مدل یادگیری ماشین" title="تشخیص رفتار غیرمعمول هر شاخص" note={intelligence.method_note || "مدل بر داده‌های مشاهده‌شده آموزش می‌بیند؛ هیچ داده یا برچسب ساختگی تولید نمی‌شود."}>
        {modelSignals.length ? <div className="ml-list">{modelSignals.map((item) => <article className="ml-row" key={item.source_id}><div className="ml-row-head"><div><b>{item.display_name}</b><small>{item.signal}</small></div><span className={item.is_anomaly ? "ml-score anomaly" : "ml-score"}>{item.score == null ? "—" : number(item.score, 3)}</span></div><p>{item.interpretation}</p><div className="ml-meta"><span>وضعیت: {item.status_label}</span><span>تاریخچه: {number(item.sample_count, 0)} نمونه</span><span>نمونهٔ آموزش: {number(item.training_samples, 0)}</span><span>ویژگی غالب: {item.dominant_feature_label}</span></div></article>)}</div> : <Empty/>}
      </Panel>
      <div className="notice"><Info size={17}/><div><b>مرز علمی مدل</b><p>Isolation Forest مدل تشخیص ناهنجاریِ بدون‌نظارت است، نه مدل طبقه‌بندی قطع اینترنت. برای تبدیل شاخص ریسک به احتمال واقعی، به تاریخچهٔ رخدادهای تأییدشده، ارزیابی خارج از نمونه و کالیبراسیون نیاز داریم؛ این نسخه چنین احتمالی جعل نمی‌کند.</p></div></div>
    </div>;
  }
  else if (page === "signals") body = <div className="stack">
    <div className="intro page-intro"><small><Signal size={14}/> پایش شاخص‌ها</small><h2>سیگنال‌های شبکه</h2><p>هر سیگنال با واحد، خط مبنا، دامنه و نمودار مستقل خودش بررسی می‌شود؛ مقادیر ناهم‌واحد با هم ادغام نمی‌شوند.</p></div>
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
        <div className="signal-card-head"><Badge value={signal.freshness_status}/><span>{signal.data_state_label}</span><a href={signal.source_url} target="_blank" rel="noreferrer">مستندات منبع ↗</a></div>
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
          <span>کمینه: <b>{number(signal.minimum_value)}</b></span><span>میانه: <b>{number(signal.median_value)}</b></span><span>بیشینه: <b>{number(signal.maximum_value)}</b></span><span>آخرین جمع‌آوری: <b>{time(signal.last_collected_at)}</b></span>
        </div>
        {signal.current_anomaly && <div className="signal-alert"><AlertTriangle size={15}/> تغییر غیرعادی در این سیگنال ثبت شده؛ برای تعیین اهمیت شبکه‌ای به شواهد مکمل نیاز است.</div>}
      </Panel>;
    }) : <Empty title="سیگنالی برای تحلیل موجود نیست" note="اتصال منبع داده یا پاسخ API را بررسی کنید."/>}
  </div>;
  else if (page === "events") body = <div className="stack">
    <div className="intro page-intro"><small><AlertTriangle size={14}/> دفتر رخدادها</small><h2>رخدادهای شناسایی‌شده</h2><p>انحراف آماری، تأخیر داده و خطای جمع‌آوری از هم جدا هستند. رخداد چندسیگناله همچنان «مشکوک» است و خودکار تأیید قطعی نمی‌شود.</p></div>
    <div className="metrics">
      <Stat icon={AlertTriangle} label="کل رخدادها" value={number(events.length, 0)} hint="رخدادهای پنجرهٔ انتخابی"/>
      <Stat icon={ShieldAlert} label="شدت بالا یا بحرانی" value={number(events.filter((event) => ["critical", "high"].includes(event.severity)).length, 0)} hint="نیازمند توجه"/>
      <Stat icon={Signal} label="رخداد چندسیگناله" value={number(events.filter((event) => event.status === "suspected").length, 0)} hint="نیازمند تأیید مستقل"/>
      <Stat icon={Clock3} label="مشکلات جمع‌آوری" value={number(events.filter((event) => ["source_stale", "collector_error"].includes(event.event_type)).length, 0)} hint="عملیاتی، نه الزاماً اختلال شبکه"/>
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
    <div className="intro"><small>منابع داده</small><h2>پوشش منابع نسخهٔ اول</h2><p>سه سیگنال ملی IODA در pipeline فعال هستند؛ منابع مکمل هنوز به جمع‌آوری خودکار متصل نشده‌اند.</p></div>
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
      <article><small>۰۱</small><h3>Observed · مشاهده‌شده</h3><p>مقدار، زمان و منبعی که مستقیم دریافت و ذخیره شده است.</p></article>
      <article><small>۰۲</small><h3>Suspected · مشکوک</h3><p>چند نشانهٔ هم‌جهت و مستقل وجود دارد، اما شواهد برای تأیید کافی نیست.</p></article>
      <article><small>۰۳</small><h3>Confirmed · تأییدشده</h3><p>فقط پس از معیارهای مستقل، تکرارپذیر و کنترل کیفیت؛ این وضعیت در نسخهٔ فعلی خودکار صادر نمی‌شود.</p></article>
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
      <div className="sidefoot"><i/>{number(fresh, 0)} منبع تازه از {number(data.sources.length, 0)}<small>نسخه ۱٫۱ · NetGuard</small></div>
    </aside>
    <main>
      <header className="topbar"><div>نت‌گارد <b>/</b> <strong>{current[1]}</strong></div>
        <div className="actions"><span>ایران · ملی</span><button onClick={load} disabled={data.busy}><RefreshCw size={15}/>{data.busy ? "در حال دریافت" : "به‌روزرسانی"}</button></div>
      </header>
      <div className="content">
        {data.error && <div className="warning"><AlertTriangle/><div><b>دریافت داده ناموفق بود</b><p>{data.error} دادهٔ ساختگی جایگزین نمی‌شود.</p></div></div>}
        {body}
      </div>
      <footer><span>NetGuard · پایش شواهد عمومی</span><span>بازخوانی هر ۶۰ ثانیه · زمان نمایش ایران</span></footer>
    </main>
  </div>;
}
