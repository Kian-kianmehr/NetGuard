import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDownRight, BookOpen, CheckCircle2, CircleHelp,
  Clock3, Database, Globe2, Info, RadioTower, RefreshCw, ShieldAlert,
  ShieldCheck, Signal, Sparkles, TrendingDown, TrendingUp, Zap
} from "lucide-react";

const NAV = [
  ["overview", "نمای کلی", Globe2],
  ["analysis", "تحلیل هوشمند", Sparkles],
  ["signals", "سیگنال‌ها", Signal],
  ["events", "رخدادها", AlertTriangle],
  ["sources", "منابع داده", Database],
  ["method", "روش‌شناسی", BookOpen],
];
const API = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
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
  const [data, setData] = useState({
    sources: [], observations: [], analysis: null, events: [],
    generated_at: null, error: "", busy: true,
  });

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
  const overall = !data.sources.length ? "نامشخص" : fresh === data.sources.length ? "دریافت داده فعال" : "داده نیازمند بررسی";
  const current = NAV.find((item) => item[0] === page) || NAV[0];
  const filteredEvents = useMemo(() => events.filter((event) =>
    eventFilter === "all" || event.severity === eventFilter
  ), [events, eventFilter]);

  let body;
  if (page === "overview") body = <>
    <div className="hero">
      <div><small>مرکز پایش ملی · ایران</small><h2>{overall}</h2>
        <p>{number(fresh, 0)} منبع تازه · {number(attention, 0)} منبع قدیمی یا خطادار</p>
        <div className="meta"><span>آخرین مشاهده: {time(data.sources.map((source) => source.last_observed_at).filter(Boolean).sort().at(-1))}</span><span>آخرین دریافت API: {time(data.generated_at)}</span></div>
      </div><div className="orb"><Globe2 size={40}/><b>IR</b></div>
    </div>
    <div className="metrics">
      {[[RadioTower, "منابع ثبت‌شده", data.sources.length], [CheckCircle2, "منابع تازه", fresh], [AlertTriangle, "قدیمی یا خطادار", attention], [Activity, "مشاهدات بازه", data.observations.length]].map(([Icon, label, value]) =>
        <Stat key={label} icon={Icon} label={label} value={number(value, 0)} hint="دادهٔ ثبت‌شده"/>
      )}
    </div>
    <div className="columns">
      <Panel tag="تحلیل هوشمند" title={analysis.assessment_label || "منتظر داده"} note={analysis.summary || "تحلیل پس از دریافت تاریخچهٔ کافی نمایش داده می‌شود."}>
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
      <div className="intro page-intro"><small><Sparkles size={14}/> موتور تحلیل هوشمند NetGuard</small><h2>تحلیل وضعیت شبکه</h2><p>ارزیابی توضیح‌پذیر از رفتار سیگنال‌های ملی، کفایت داده و رخدادهای شناسایی‌شده.</p></div>
      <section className={"analysis-hero " + tone}>
        <div className="analysis-mark"><AssessmentIcon size={27}/></div>
        <div className="analysis-main"><small>ارزیابی فعلی</small><h2>{analysis.assessment_label || "دادهٔ کافی نیست"}</h2><p>{analysis.summary || "پس از دریافت دادهٔ معتبر، تحلیل نمایش داده می‌شود."}</p>
          <div className="analysis-stamp"><span><Clock3 size={13}/> {time(analysis.generated_at || data.generated_at)}</span><span><Zap size={13}/> {analysis.engine || "NetGuard Analytics"}</span></div>
        </div>
        <div className="coverage-ring" style={{ "--coverage": (analysis.data_coverage_percent || 0) + "%" }}><b>{number(analysis.data_coverage_percent, 0)}٪</b><small>کفایت داده</small></div>
      </section>
      <div className="metrics">
        <Stat icon={Database} label="منابع قابل استفاده" value={number(analysis.usable_sources, 0) + " / " + number(analysis.total_sources, 0)} hint="تاریخچه کافی و داده تازه"/>
        <Stat icon={AlertTriangle} label="منابع دارای انحراف" value={number(analysis.anomalous_sources, 0)} hint="انحراف از خط مبنای هر سیگنال" tone={analysis.anomalous_sources ? "warn" : "default"}/>
        <Stat icon={RadioTower} label="منابع تازه" value={number(analysis.fresh_sources, 0)} hint="بر اساس زمان مشاهده"/>
        <Stat icon={Activity} label="رخدادهای پنجره" value={number(analysis.events_count, 0)} hint="رخدادهای شناسایی‌شده"/>
      </div>
      <Panel tag="خروجی مدل" title="یافته‌های اصلی" note="هر یافته به دادهٔ مشخص متصل است و نتیجهٔ قطعی دربارهٔ علت اختلال ارائه نمی‌کند.">
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
        <Panel tag="محدودیت مدل" title="تفسیر درست نتیجه">
          <ul className="caveats">{(analysis.limitations || []).map((item) => <li key={item}>{item}</li>)}</ul>
        </Panel>
      </div>
      <div className="notice"><Info size={17}/><div><b>دربارهٔ هوش مصنوعی این نسخه</b><p>این نسخه از تشخیص ناهنجاری توضیح‌پذیر بر پایهٔ میانه، MAD و هم‌زمانی شاخص‌های مستقل استفاده می‌کند. برای حفظ اجرای رایگان، داده به API مدل زبانی خارجی فرستاده نمی‌شود؛ امتیاز شواهد نیز احتمال وقوع اختلال نیست.</p></div></div>
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
