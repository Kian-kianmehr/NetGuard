import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDownLeft, ArrowUpLeft, BarChart3, BookOpen,
  Check, ChevronLeft, CircleHelp, Clock3, Command, Gauge, Globe2, Layers3,
  Menu, RadioTower, RefreshCw, ShieldAlert, Signal, Wifi, X,
} from "lucide-react";
import Chart from "chart.js/auto";

const NAV = [
  { id: "overview", label: "نمای کلی", icon: Gauge },
  { id: "analysis", label: "تحلیل وضعیت", icon: Activity },
  { id: "signals", label: "سیگنال‌ها", icon: Signal },
  { id: "events", label: "رخدادهای مشاهده‌شده", icon: Clock3 },
  { id: "method", label: "روش‌شناسی", icon: BookOpen },
];
const LABELS = { bgp: "دیدپذیری BGP", "ping-slash24": "پایش فعال", "merit-nt": "تلسکوپ شبکه" };
const COLORS = { bgp: "#171717", "ping-slash24": "#777770", "merit-nt": "#b9b9b1" };
const fmt = (v) => new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(v);
const pct = (v) => `${v > 0 ? "+" : ""}${fmt(v)}٪`;
const date = (ts) => ts ? new Intl.DateTimeFormat("fa-IR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(ts * 1000)) + " UTC" : "نامشخص";

function useDashboard(hours) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    try {
      const params = new URLSearchParams({ hours: String(hours) });
      if (force) params.set("refresh", "true");
      const response = await fetch(`/api/dashboard?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`خطای سرویس: ${response.status}`);
      const payload = await response.json();
      setData(payload);
      setError("");
      return payload;
    } catch (err) {
      setError(err.message || "ارتباط با سرویس برقرار نشد");
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hours]);
  useEffect(() => {
    let active = true;
    let timer;
    const tick = async () => {
      if (!active) return;
      const result = await load();
      if (active && result?.refresh_in_progress) timer = setTimeout(tick, 1800);
      else if (active) timer = setTimeout(tick, 60000);
    };
    tick();
    return () => { active = false; clearTimeout(timer); };
  }, [load]);
  return { data, loading, error, refreshing, refresh: () => load(true) };
}

function ChartCanvas({ datasets, height = 250, normalized = false }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current || !datasets.length) return;
    const chart = new Chart(canvasRef.current, {
      type: "line",
      data: { datasets: datasets.map((s) => {
        const first = (s.points || []).find((p) => p.value !== null)?.value;
        return {
          label: LABELS[s.id] || s.label,
          data: (s.points || []).filter((p) => p.value !== null).map((p) => ({ x: p.timestamp * 1000, y: normalized ? (first ? p.value / first * 100 : null) : p.value })),
          borderColor: COLORS[s.id] || "#555",
          backgroundColor: COLORS[s.id] || "#555",
          borderWidth: 2, pointRadius: 0, tension: 0.2, spanGaps: false,
        };
      }) },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: "nearest", intersect: false },
        plugins: { legend: { display: false }, tooltip: { backgroundColor: "#171717", titleFont: { family: "Vazirmatn" }, bodyFont: { family: "Vazirmatn" } } },
        scales: {
          x: { type: "linear", ticks: { maxTicksLimit: 6, color: "#92928b", font: { family: "Vazirmatn", size: 10 }, callback: (v) => date(v / 1000).replace(" UTC", "") }, grid: { color: "#eeeeea" } },
          y: { ticks: { color: "#92928b", font: { family: "IBM Plex Mono", size: 10 } }, grid: { color: "#eeeeea" }, title: { display: normalized, text: "شاخص نسبی (مبنا = ۱۰۰)", font: { family: "Vazirmatn" } } },
        },
      },
    });
    return () => chart.destroy();
  }, [datasets, normalized]);
  return <div className="chart-canvas" style={{ height }}><canvas ref={canvasRef} /></div>;
}
function Panel({ eyebrow, title, subtitle, children, className = "" }) {
  return <section className={`panel ${className}`}><div className="panel-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>{children}</section>;
}
function MetricCard({ item }) {
  return <article className="metric-card"><div className="metric-head"><strong>{LABELS[item.id] || item.label}</strong><span className={item.status === "available" ? "pill" : "pill muted"}>{item.status === "available" ? "داده موجود" : "بدون داده"}</span></div><div className="metric-value">{item.latest == null ? "—" : fmt(item.latest)}</div><div className="metric-unit">{item.unit}</div><p>{item.description}</p><div className="metric-foot"><span>{fmt(item.observations)} مشاهده معتبر</span><span>{date(item.latest_at)}</span></div></article>;
}
function delta(item) {
  const values = (item.points || []).filter((p) => p.value !== null);
  if (values.length < 4) return null;
  const mid = Math.floor(values.length / 2);
  const avg = (a) => a.reduce((sum, p) => sum + p.value, 0) / a.length;
  const first = avg(values.slice(0, mid)), second = avg(values.slice(mid));
  return first ? (second - first) / Math.abs(first) * 100 : null;
}
function eventsFrom(series) {
  return series.flatMap((s) => {
    const pts = (s.points || []).filter((p) => p.value !== null);
    return pts.slice(1).flatMap((point, i) => {
      const previous = pts[i];
      if (!previous.value) return [];
      const change = (point.value - previous.value) / Math.abs(previous.value) * 100;
      return Math.abs(change) >= 15 ? [{ id: s.id, label: LABELS[s.id] || s.label, timestamp: point.timestamp, value: point.value, change }] : [];
    });
  }).sort((a, b) => b.timestamp - a.timestamp).slice(0, 80);
}
function analyze(data) {
  const series = data?.series || [];
  const usable = series.filter((s) => (s.points || []).some((p) => p.value !== null));
  const drops = usable.filter((s) => delta(s) !== null && delta(s) <= -10);
  const changes = usable.filter((s) => delta(s) !== null && Math.abs(delta(s)) >= 10);
  const fresh = usable.filter((s) => s.latest_at && Date.now() / 1000 - s.latest_at < 21600);
  if (!usable.length) return { title: "وضعیت نامشخص؛ داده معتبر موجود نیست", summary: "تا دریافت داده معتبر از منابع نمی‌توان درباره وضعیت اینترنت ایران نتیجه‌گیری کرد.", confidence: "ناکافی", drops, usable, fresh };
  if (drops.length >= 2) return { title: "کاهش هم‌زمان در چند شاخص مشاهده شده", summary: "حداقل دو منبع در مقایسه دو نیمه بازه کاهش قابل توجه دارند. این هم‌زمانی نیازمند بررسی است، اما به‌تنهایی قطعی سراسری یا علت آن را ثابت نمی‌کند.", confidence: fresh.length >= 2 ? "متوسط" : "پایین", drops, usable, fresh };
  if (drops.length === 1) return { title: "کاهش قابل توجه در یک منبع", summary: "یک سیگنال افت نشان می‌دهد اما منابع دیگر کاهش هم‌جهت را تأیید نمی‌کنند؛ فعلاً باید آن را محدود به همان منبع دانست.", confidence: "محدود", drops, usable, fresh };
  return { title: changes.length ? "تغییر قابل توجه با الگوی غیرهم‌جهت" : "کاهش هم‌زمان قابل توجهی مشاهده نشد", summary: changes.length ? "چند منبع تغییر محسوسی دارند، اما جهت تغییر یکسان نیست. به دلیل تفاوت روش اندازه‌گیری، نتیجه‌گیری باید محتاطانه باشد." : "در داده‌های فعلی کاهش بزرگ و هم‌جهت دیده نمی‌شود. این موضوع سلامت اتصال همه کاربران یا مناطق را ثابت نمی‌کند.", confidence: fresh.length >= 2 ? "متوسط" : "پایین", drops, usable, fresh };
}

function Sidebar({ page, setPage, mobileOpen, setMobileOpen }) {
  return <><button className="mobile-menu" onClick={() => setMobileOpen(!mobileOpen)} aria-label="باز کردن منو">{mobileOpen ? <X /> : <Menu />}</button><aside className={`sidebar ${mobileOpen ? "open" : ""}`}><a className="brand" href="/" onClick={(e) => { e.preventDefault(); setPage("overview"); }}><span className="brand-symbol">N</span><span>نت‌گارد<span className="brand-slash">/</span></span></a><div className="side-caption">مرکز پایش شبکه</div><nav>{NAV.map(({ id, label, icon: Icon }, i) => <button key={id} className={page === id ? "nav-item active" : "nav-item"} onClick={() => { setPage(id); setMobileOpen(false); }}><Icon size={17} /><span>{label}</span><small>0{i + 1}</small></button>)}</nav><div className="sidebar-bottom"><div className="country-card"><span className="country-code">IR</span><div><strong>ایران</strong><small>کشور تحت پایش</small></div><i /></div><p>سامانه پایش سیگنال‌های عمومی</p></div></aside></>;
}
function Overview({ data, analysis, setPage, hours, setHours }) {
  const series = data?.series || [];
  return <><div className="page-heading"><div><span className="eyebrow">پایش زنده / شبکه اینترنت ایران</span><h1>تصویر لحظه‌ای از <em>وضعیت اینترنت ایران</em></h1><p>پایش مستقل سیگنال‌های زیرساختی، بررسی تغییرات شبکه و ارائه تحلیلی محتاطانه از وضعیت اتصال.</p></div><div className="heading-stamp"><small>آخرین به‌روزرسانی</small><strong>{data?.generated_at ? date(Date.parse(data.generated_at) / 1000) : "در انتظار داده"}</strong><span>زمان مرجع: UTC</span></div></div>
    <div className="toolbar"><div><strong>نمای کلی شبکه</strong><small>خلاصه وضعیت در بازه انتخاب‌شده</small></div><label>بازه زمانی <select value={hours} onChange={(e) => setHours(Number(e.target.value))}><option value="24">۲۴ ساعت</option><option value="48">۴۸ ساعت</option><option value="72">۳ روز</option><option value="168">۷ روز</option></select></label></div>
    <div className="status-strip"><span className="status-icon">{data?.feed_status === "available" ? <Check /> : <Activity />}</span><div><strong>{data?.feed_status === "available" ? "داده‌های هر سه منبع دریافت شده‌اند" : data?.feed_status === "partial" ? "دریافت داده‌ها ناقص است" : data?.feed_status === "unavailable" ? "منبع داده فعلاً در دسترس نیست" : "در حال دریافت داده‌ها"}</strong><p>{data?.stale ? "آخرین داده ذخیره‌شده نمایش داده می‌شود؛ به‌روزرسانی ادامه دارد." : data?.notice || "صفحه آماده است؛ داده‌ها در پس‌زمینه دریافت می‌شوند."}</p></div><span className="status-meta">{data?.provider || "IODA"}</span></div>
    <div className="section-title"><span>01</span><strong>شاخص‌های زیرساختی</strong><small>مقادیر آخرین مشاهده معتبر؛ واحد هر شاخص متفاوت است</small></div>
    <div className="metrics-grid">{series.length ? series.map((s) => <MetricCard key={s.id} item={s} />) : <div className="empty-state"><Activity /><strong>هنوز داده‌ای دریافت نشده</strong><p>می‌توانی صفحات دیگر را بدون انتظار برای منبع داده بررسی کنی.</p></div>}</div>
    <div className="content-grid"><Panel eyebrow="A / TREND" title="روند هم‌مقیاس سیگنال‌ها" subtitle="تغییر نسبی هر منبع نسبت به اولین مقدار معتبر در بازه؛ شاخص ۱۰۰ یعنی مقدار مبنا."><ChartCanvas datasets={series} height={280} normalized /><Legend series={series} /></Panel><Panel eyebrow="B / ANALYSIS" title="برداشت اولیه سامانه" subtitle="جمع‌بندی خودکار از تازگی و هم‌جهتی داده‌ها"><div className="analysis-copy"><strong>{analysis.title}</strong><p>{analysis.summary}</p><span>سطح اطمینان: {analysis.confidence}</span></div><button className="text-link" onClick={() => setPage("analysis")}>مشاهده تحلیل کامل <ChevronLeft size={15} /></button></Panel></div>
    <Panel eyebrow="C / COMPARISON" title="مقایسه تغییرات منابع" subtitle="مقایسه نیمه ابتدایی و انتهایی بازه؛ نه مقایسه مستقیم واحدها"><Comparison series={series} /></Panel>
  </>;
}
function Legend({ series }) { return <div className="legend">{series.map((s) => <span key={s.id}><i style={{ background: COLORS[s.id] }} />{LABELS[s.id] || s.label}</span>)}</div>; }
function Comparison({ series }) {
  return <div className="table-wrap"><table><thead><tr><th>منبع</th><th>مقدار اخیر</th><th>تغییر در بازه</th><th>نقاط معتبر</th><th>آخرین مشاهده</th></tr></thead><tbody>{series.map((s) => { const change = delta(s); return <tr key={s.id}><td>{LABELS[s.id] || s.label}</td><td>{s.latest == null ? "—" : fmt(s.latest) + " " + s.unit}</td><td className={change > 2 ? "up" : change < -2 ? "down" : ""}>{change == null ? "داده ناکافی" : pct(change)}</td><td>{fmt(s.observations)}</td><td>{date(s.latest_at)}</td></tr>; })}{!series.length && <tr><td colSpan="5">در انتظار داده</td></tr>}</tbody></table></div>;
}
function AnalysisPage({ data, analysis }) {
  const series = data?.series || [];
  return <><PageHeading eyebrow="NETGUARD / INTELLIGENCE" title="تحلیل وضعیت شبکه" description="بر اساس داده‌های در دسترس، وضعیت اینترنت ایران در این بازه چه تصویری دارد؟" stamp={analysis.confidence} /><div className="analysis-hero"><span>ارزیابی فعلی</span><h2>{analysis.title}</h2><p>{analysis.summary}</p><small>{analysis.usable.length} منبع معتبر از ۳ منبع · {analysis.fresh.length} منبع با داده تازه‌تر از ۶ ساعت</small></div><div className="two-col"><Panel eyebrow="01 / CURRENT PICTURE" title="الان چه می‌بینیم؟">{series.map((s) => <p className="prose-row" key={s.id}><b>{LABELS[s.id] || s.label}:</b> مقدار اخیر {s.latest == null ? "ناموجود" : fmt(s.latest) + " " + s.unit}؛ تغییر {delta(s) == null ? "نامشخص" : pct(delta(s))}؛ آخرین مشاهده {date(s.latest_at)}.</p>)}</Panel><Panel eyebrow="02 / SIGNAL AGREEMENT" title="هم‌خوانی سیگنال‌ها"><p className="prose-row">{analysis.drops.length >= 2 ? "چند منبع کاهش هم‌جهت دارند؛ این هم‌جهتی سطح توجه را افزایش می‌دهد، نه اینکه علت را مشخص کند." : "منابع موجود کاهش هم‌جهت گسترده‌ای را تأیید نمی‌کنند. هر منبع بخش متفاوتی از شبکه را اندازه می‌گیرد."}</p></Panel><Panel eyebrow="03 / DATA QUALITY" title="کیفیت و محدودیت داده"><p className="prose-row">منابع معتبر: {analysis.usable.length} از ۳ · مشاهدات: {fmt(series.reduce((n, s) => n + (s.observations || 0), 0))} · نقاط مفقود: {fmt(series.reduce((n, s) => n + (s.missing || 0), 0))}.</p><p className="prose-row">بازه تحلیل: {fmt(data?.window_hours || 24)} ساعت. نقاط مفقود صفر فرض نمی‌شوند.</p></Panel><Panel eyebrow="04 / LIMITS" title="چه چیزی را نمی‌توان نتیجه گرفت؟"><p className="prose-row">افت یک شاخص به‌تنهایی اثبات‌کننده قطعی سراسری، فیلترینگ، تحریم یا مشکل اپراتور نیست. برای انتساب علت به آزمون‌های مستقل و شواهد تکمیلی نیاز است.</p></Panel></div></>;
}
function PageHeading({ eyebrow, title, description, stamp }) { return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{stamp && <div className="heading-stamp"><small>سطح اطمینان داده</small><strong>{stamp}</strong></div>}</div>; }
function SignalsPage({ series }) { return <><PageHeading eyebrow="NETGUARD / MEASUREMENT LAYERS" title="کاوش سیگنال‌ها" description="هر منبع بخش متفاوتی از شبکه را اندازه می‌گیرد؛ نمودارها و مقادیر خام را جداگانه بررسی کنید." />{series.length ? <div className="signal-list">{series.map((s) => <Panel key={s.id} eyebrow={s.id.toUpperCase()} title={LABELS[s.id] || s.label} subtitle={s.description}><div className="signal-summary"><strong>{s.latest == null ? "—" : fmt(s.latest)}</strong><span>{s.unit}</span><small>{fmt(s.observations)} مشاهده معتبر · آخرین مشاهده {date(s.latest_at)}</small></div><ChartCanvas datasets={[s]} height={190} /></Panel>)}</div> : <EmptyState text="داده سیگنال‌ها هنوز در دسترس نیست." />}</>; }
function EventsPage({ series }) {
  const events = useMemo(() => eventsFrom(series), [series]);
  return <><PageHeading eyebrow="NETGUARD / OBSERVED CHANGES" title="رخدادهای مشاهده‌شده" description="تغییرات عددی قابل استخراج از داده‌های دریافتی؛ این موارد لزوماً رخداد قطعی یا علت اختلال نیستند." /><div className="event-stats"><div><strong>{fmt(events.length)}</strong><span>تغییر قابل توجه</span></div><div><strong>{fmt(events.filter((e) => e.change < 0).length)}</strong><span>کاهش ≥۱۵٪</span></div><div><strong>{fmt(events.filter((e) => e.change > 0).length)}</strong><span>افزایش ≥۱۵٪</span></div></div><Panel eyebrow="EVENT STREAM" title="دفتر تغییرات مشاهده‌شده" subtitle="تغییر بین نقاط متوالی همان منبع"><div className="event-list">{events.length ? events.map((e, i) => <div className="event-row" key={e.id + e.timestamp + i}><time>{date(e.timestamp)}</time><div><b>{e.label} · {pct(e.change)}</b><small>مقدار مشاهده‌شده: {fmt(e.value)}</small></div><span>تغییر مشاهده‌شده</span></div>) : <EmptyState text="در نقاط معتبر این بازه تغییر متوالی بزرگ‌تر از ۱۵٪ شناسایی نشد." />}</div></Panel></>;
}
function MethodPage() {
  const methods = [
    ["SOURCE 01", "دیدپذیری BGP", "تعداد شبکه‌های IPv4 با پیشوند /24 که در داده‌های مسیریابی BGP قابل مشاهده‌اند. تغییر آن می‌تواند نشانه تغییر در دیدپذیری مسیرها باشد؛ اما تجربه کاربران را مستقیماً نشان نمی‌دهد.", "شبکه‌های IPv4 /24 قابل مشاهده"],
    ["SOURCE 02", "پایش فعال", "تعداد شبکه‌های IPv4 /24 که به کاوش فعال IODA پاسخ داده‌اند. این شاخص به روش، نقاط سنجش و زمان اجرای آزمون وابسته است.", "شبکه‌های IPv4 /24 پاسخ‌گو"],
    ["SOURCE 03", "تلسکوپ شبکه", "تعداد IPهای مبدأ یکتای مشاهده‌شده توسط تلسکوپ شبکه Merit. این داده ماهیت متفاوتی از دو شاخص دیگر دارد.", "IP مبدأ یکتا"],
    ["INTERPRETATION", "منطق تحلیل NetGuard", "تغییرات هر سری زمانی نسبت به نقاط قبلی همان سری بررسی می‌شود. هم‌زمانی تغییر چند منبع سطح توجه را افزایش می‌دهد؛ اما بدون شواهد مستقل، علت به آن نسبت داده نمی‌شود.", "مشاهده ≠ تشخیص علت"],
  ];
  return <><PageHeading eyebrow="NETGUARD / METHODOLOGY" title="روش‌شناسی و منابع داده" description="این صفحه توضیح می‌دهد NetGuard چه چیزی را اندازه می‌گیرد، چگونه تفسیر می‌کند و چه ادعاهایی نمی‌کند." /><div className="method-grid">{methods.map(([tag, title, body, unit]) => <Panel key={tag} eyebrow={tag} title={title}><p className="prose-row">{body}</p><span className="method-unit">{unit}</span></Panel>)}</div><Panel eyebrow="DATA ATTRIBUTION" title="منبع و محدودیت‌ها"><p className="prose-row">منبع داده: <a href="https://ioda.inetintel.cc.gatech.edu/" target="_blank" rel="noreferrer">IODA از Georgia Tech</a> · <a href="https://api.ioda.inetintel.cc.gatech.edu/v2/docs" target="_blank" rel="noreferrer">مستندات API</a>.</p><p className="prose-row">داده‌ها نماینده مستقیم تجربه تمام کاربران اینترنت ایران نیستند. نقاط مفقود به‌عنوان صفر تفسیر نمی‌شوند. این نسخه پیش‌بینی قطعی، تشخیص سانسور، تفکیک تحریم از فیلترینگ یا تعیین علت اختلال انجام نمی‌دهد.</p></Panel></>;
}
function EmptyState({ text }) { return <div className="empty-state"><CircleHelp /><p>{text}</p></div>; }

export default function App() {
  const [page, setPage] = useState("overview");
  const [hours, setHours] = useState(24);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data, loading, error, refreshing, refresh } = useDashboard(hours);
  const analysis = useMemo(() => analyze(data), [data]);
  const series = data?.series || [];
  const title = NAV.find((item) => item.id === page)?.label || "نمای کلی";
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} /><main className="main-area"><header className="topbar"><div className="breadcrumb"><span>ایران</span><b>/</b><strong>{title}</strong></div><div className="top-actions"><span className="live-label"><i />پایش داده‌های عمومی</span><button className="refresh-button" onClick={refresh} disabled={refreshing}><RefreshCw size={14} className={refreshing ? "spin" : ""} />به‌روزرسانی</button></div></header><div className="page-content">
    {error && <div className="error-banner"><AlertTriangle size={17} /><span>{error} — صفحات تحلیلی و روش‌شناسی همچنان قابل استفاده‌اند.</span></div>}
    {page === "overview" && <Overview data={data} analysis={analysis} setPage={setPage} hours={hours} setHours={setHours} />}
    {page === "analysis" && <AnalysisPage data={data} analysis={analysis} />}
    {page === "signals" && <SignalsPage series={series} />}
    {page === "events" && <EventsPage series={series} />}
    {page === "method" && <MethodPage />}
    </div><footer><span>نت‌گارد / دیده‌بانی مستقل اینترنت ایران</span><span>داده خام: IODA · دانشگاه جورجیا تک</span></footer></main></div>;
}