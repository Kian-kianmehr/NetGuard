import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, BookOpen, CheckCircle2, Database, Globe2, RadioTower, RefreshCw, ShieldCheck, Signal } from "lucide-react";

const NAV = [
  ["overview", "نمای کلی", Globe2],
  ["analysis", "تحلیل وضعیت", Activity],
  ["signals", "سیگنال‌ها", Signal],
  ["events", "رخدادها", AlertTriangle],
  ["sources", "منابع داده", Database],
  ["method", "روش‌شناسی", BookOpen],
];
const BASE = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();
const fmt = (x) => x == null ? "—" : new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(Number(x));
const date = (x) => x ? new Intl.DateTimeFormat("fa-IR", { timeZone: "Asia/Tehran", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(x)) : "نامشخص";
const ago = (s) => s == null ? "نامشخص" : fmt(Math.floor(s / 60)) + " دقیقه پیش";
const statusLabels = {
  fresh: ["تازه", "good"], stale: ["قدیمی", "warn"],
  degraded: ["دارای خطا", "warn"], unknown: ["نامشخص", "neutral"],
};

async function readView(view, params) {
  const headers = { apikey: KEY, Accept: "application/json" };
  if (KEY.startsWith("eyJ")) headers.Authorization = "Bearer " + KEY;
  const response = await fetch(BASE + "/rest/v1/" + view + "?" + new URLSearchParams(params), { headers, cache: "no-store" });
  if (!response.ok) throw new Error("Supabase " + response.status);
  return response.json();
}
function Badge({ value }) {
  const [label, tone] = statusLabels[value] || statusLabels.unknown;
  return <span className={"badge " + tone}><i />{label}</span>;
}
function Panel({ tag, title, note, children }) {
  return <section className="panel"><header><small>{tag}</small><h2>{title}</h2>{note && <p>{note}</p>}</header>{children}</section>;
}
function Empty({ title = "داده‌ای برای نمایش نیست", note = "پس از راه‌اندازی جمع‌آوری‌کننده، دادهٔ واقعی اینجا نمایش داده می‌شود." }) {
  return <div className="empty"><b>∅</b><strong>{title}</strong><p>{note}</p></div>;
}
function SourceTable({ rows }) {
  if (!rows.length) return <Empty title="هنوز منبعی داده نداده است" />;
  return <div className="table-wrap"><table><thead><tr><th>منبع</th><th>وضعیت</th><th>آخرین مشاهده</th><th>آخرین اجرا</th><th>مقدار</th></tr></thead>
    <tbody>{rows.map((s) => <tr key={s.source_id}>
      <td><b>{s.display_name}</b><small>{s.provider} · {s.signal}</small></td>
      <td><Badge value={s.freshness_status} /></td>
      <td>{date(s.last_observed_at)}<small>{ago(s.observation_age_seconds)}</small></td>
      <td>{date(s.last_run_started_at)}<small>{s.last_run_status || "بدون اجرا"}</small></td>
      <td><b>{fmt(s.latest_value)}</b><small>{s.unit}</small></td>
    </tr>)}</tbody>
  </table></div>;
}
function Chart({ rows }) {
  const valid = rows.filter((r) => r.quality === "valid" && Number.isFinite(Number(r.value)));
  if (!valid.length) return <Empty title="تاریخچه هنوز جمع‌آوری نشده" />;
  const values = valid.map((r) => Number(r.value));
  const lo = Math.min(...values);
  const span = Math.max(Math.max(...values) - lo, 0.000001);
  const points = valid.map((r, i) => {
    const x = 20 + i / Math.max(1, valid.length - 1) * 860;
    const y = 170 - (Number(r.value) - lo) / span * 140;
    return x + "," + y;
  }).join(" ");
  return <div className="chart"><svg viewBox="0 0 900 190" preserveAspectRatio="none">
    <line x1="20" x2="880" y1="30" y2="30" /><line x1="20" x2="880" y1="100" y2="100" /><line x1="20" x2="880" y1="170" y2="170" />
    <polyline points={points} fill="none" stroke="#63d7b7" strokeWidth="3" />
  </svg><div className="axis"><span>{date(valid[0].observed_at)}</span><span>{date(valid.at(-1).observed_at)}</span></div></div>;
}
function detectAnomalies(sources, groups) {
  return sources.flatMap((source) => {
    const rows = (groups[source.source_id] || []).filter((x) => x.quality === "valid");
    if (rows.length < 15) return [];
    const base = rows.slice(-15, -3).map((x) => Number(x.value)).sort((a, b) => a - b);
    const median = base[Math.floor(base.length / 2)];
    if (!Number.isFinite(median) || Math.abs(median) < 1e-9) return [];
    const current = rows.slice(-3).reduce((sum, x) => sum + Number(x.value), 0) / 3;
    const change = (current - median) / Math.abs(median) * 100;
    return Math.abs(change) >= 25 ? [{ source, change, at: rows.at(-1).observed_at }] : [];
  });
}

export default function App() {
  const [page, setPage] = useState("overview");
  const [data, setData] = useState({ sources: [], observations: [], updated: null, error: "", busy: true });
  const load = useCallback(async () => {
    if (!BASE || !KEY) {
      setData((v) => ({ ...v, busy: false, error: "آدرس Supabase یا کلید عمومی در تنظیمات Render ثبت نشده است." }));
      return;
    }
    setData((v) => ({ ...v, busy: true }));
    try {
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const [sources, observations] = await Promise.all([
        readView("dashboard_sources", { select: "*", order: "source_id.asc" }),
        readView("dashboard_observations", {
          select: "source_id,display_name,observed_at,collected_at,value,unit,geographic_scope,quality",
          observed_at: "gte." + since, order: "observed_at.asc", limit: "1800",
        }),
      ]);
      setData({ sources, observations, updated: new Date().toISOString(), error: "", busy: false });
    } catch (e) {
      setData((v) => ({ ...v, busy: false, error: e.message || "دریافت داده ناموفق بود." }));
    }
  }, []);

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

  const grouped = useMemo(() => data.observations.reduce((acc, row) => {
    (acc[row.source_id] ||= []).push(row);
    return acc;
  }, {}), [data.observations]);
  const anomalies = useMemo(() => detectAnomalies(data.sources, grouped), [data.sources, grouped]);
  const counts = data.sources.reduce((acc, source) => {
    acc[source.freshness_status] = (acc[source.freshness_status] || 0) + 1;
    return acc;
  }, {});
  const fresh = counts.fresh || 0;
  const old = (counts.stale || 0) + (counts.degraded || 0);
  const summary = !data.sources.length ? "نامشخص" : fresh ? "دریافت داده فعال" : "داده نیازمند بررسی";
  const current = NAV.find((x) => x[0] === page) || NAV[0];
  let body;

  if (page === "overview") body = <>
    <div className="hero"><div><small>مرکز پایش ملی · ایران</small><h2>{summary}</h2>
      <p>{fmt(fresh)} منبع تازه · {fmt(old)} منبع قدیمی یا خطادار</p>
      <div className="meta"><span>آخرین مشاهده: {date(data.sources.map((s) => s.last_observed_at).filter(Boolean).sort().at(-1))}</span><span>بازخوانی داشبورد: {date(data.updated)}</span></div>
    </div><div className="orb"><Globe2 size={40}/><b>IR</b></div></div>
    <div className="metrics">
      {[[RadioTower,"منابع ثبت‌شده",data.sources.length],[CheckCircle2,"منابع تازه",fresh],[AlertTriangle,"قدیمی یا خطادار",old],[Activity,"مشاهدات هفت روز",data.observations.length]].map(([I,t,v]) =>
        <article key={t}><I/><small>{t}</small><b>{fmt(v)}</b><em>دادهٔ ثبت‌شده</em></article>)}
    </div>
    <div className="columns">
      <Panel tag="روند سیگنال‌ها" title="تاریخچهٔ اندازه‌گیری" note="مقیاس هر منبع مستقل است."><Chart rows={data.observations}/></Panel>
      <Panel tag="شواهد اولیه" title="موارد نیازمند بررسی">
        {anomalies.length ? anomalies.map((e) => <div className="event" key={e.source.source_id}><AlertTriangle/><div>
          <b>{e.source.display_name}</b><p>{e.change < 0 ? "کاهش" : "افزایش"} {fmt(Math.abs(e.change))}٪ نسبت به مبنا</p><small>{date(e.at)}</small>
        </div></div>) : <Empty title="انحراف آماری ثبت نشده" note="این نتیجه سلامت کل اینترنت را ثابت نمی‌کند."/>}
      </Panel>
    </div>
    <Panel tag="سلامت ورودی داده" title="وضعیت منابع"><SourceTable rows={data.sources}/></Panel>
  </>;
  else if (page === "analysis") body = <div className="stack">
    <div className="intro"><small>تحلیل وضعیت</small><h2>چه چیزی را اکنون می‌دانیم؟</h2><p>مشاهدهٔ مستقیم از تفسیر احتمالی جداست؛ علت اختلال فقط با شواهد مستقل و چندمنبعی بررسی می‌شود.</p></div>
    <div className="summary"><ShieldCheck/><div><b>{summary}</b><p>{fresh} منبع تازه از {data.sources.length} منبع ثبت‌شده</p></div></div>
    <div className="three">
      <article><small>مشاهده‌شده</small><h3>وضعیت منابع</h3><p>{fmt(fresh)} منبع دادهٔ تازه دارند.</p></article>
      <article><small>نیازمند بررسی</small><h3>{fmt(anomalies.length)} انحراف اولیه</h3><p>تغییر آماری یک منبع رخداد قطعی نیست.</p></article>
      <article><small>علت‌یابی</small><h3>نتیجه‌گیری نمی‌شود</h3><p>یک آزمون منفرد فیلترینگ، تحریم یا خاموشی را ثابت نمی‌کند.</p></article>
    </div>
  </div>;
  else if (page === "signals") body = <div className="stack">
    <div className="intro"><small>سیگنال‌ها</small><h2>جزئیات اندازه‌گیری‌ها</h2><p>هر منبع واحد و روش مخصوص خود را دارد؛ مقادیر ناهم‌واحد را مستقیم مقایسه نکنید.</p></div>
    {data.sources.map((s) => <Panel key={s.source_id} tag={s.provider + " · " + s.signal} title={s.display_name} note={s.description}>
      <Badge value={s.freshness_status}/><div className="details">
        <div><small>آخرین مقدار</small><b>{fmt(s.latest_value)}</b><em>{s.unit}</em></div>
        <div><small>آخرین مشاهده</small><b>{date(s.last_observed_at)}</b><em>{ago(s.observation_age_seconds)}</em></div>
        <div><small>رکوردهای هفت روز</small><b>{fmt((grouped[s.source_id] || []).length)}</b></div>
      </div>
      <Chart rows={grouped[s.source_id] || []}/><a href={s.source_url} target="_blank" rel="noreferrer">مستندات منبع ↗</a>
    </Panel>)}
    {!data.sources.length && <Empty/>}
  </div>;
  else if (page === "events") body = <div className="stack">
    <div className="intro"><small>رخدادها</small><h2>موارد نیازمند بررسی</h2><p>در نسخهٔ اول فقط انحراف آماری دیده می‌شود؛ رخداد چندمنبعی به‌عنوان قطعی تأیید نمی‌شود.</p></div>
    {anomalies.length ? anomalies.map((e) => <Panel key={e.source.source_id} tag="Observed · نیازمند بررسی"
      title={e.source.display_name} note={(e.change < 0 ? "کاهش" : "افزایش") + " " + fmt(Math.abs(e.change)) + "٪ نسبت به مبنا · " + date(e.at)}>
      <Badge value="degraded"/>
    </Panel>) : <Empty title="موردی بالاتر از آستانه پیدا نشد" note="این به معنی نبود اختلال نیست؛ پوشش محدود منابع را در نظر بگیرید."/>}
  </div>;
  else if (page === "sources") body = <div className="stack">
    <div className="intro"><small>منابع داده</small><h2>منابع فعال نسخهٔ اول</h2><p>سه سیگنال ملی IODA در pipeline تعریف شده‌اند؛ منابع دیگر هنوز متصل نشده‌اند.</p></div>
    <Panel tag="ثبت منابع" title="فهرست و تازگی داده"><SourceTable rows={data.sources}/></Panel>
    <div className="three">
      <article><b>IODA · Georgia Tech</b><p>منبع اصلی سیگنال‌های زیرساختی نسخهٔ نخست.</p><a href="https://api.ioda.inetintel.cc.gatech.edu/v2/docs" target="_blank" rel="noreferrer">مستندات API ↗</a></article>
      <article><b>RouteViews</b><p>شواهد مکمل مسیرها؛ هنوز متصل نشده.</p><a href="https://www.routeviews.org/" target="_blank" rel="noreferrer">وب‌سایت ↗</a></article>
      <article><b>OONI</b><p>منبع مکمل بررسی دسترسی؛ منبع پنج‌دقیقه‌ای نیست.</p><a href="https://measurements.ooni.org/" target="_blank" rel="noreferrer">پرتال داده ↗</a></article>
    </div>
  </div>;
  else body = <div className="stack">
    <div className="intro"><small>روش‌شناسی</small><h2>داده چه می‌گوید و چه چیزی را ثابت نمی‌کند؟</h2><p>شفافیت منبع، زمان و محدودیت‌ها بخشی از محصول است.</p></div>
    <div className="three">
      <article><small>۰۱</small><h3>Observed · مشاهده‌شده</h3><p>مقدار، زمان و منبعی که مستقیم دریافت و ذخیره شده است.</p></article>
      <article><small>۰۲</small><h3>Suspected · مشکوک</h3><p>چند نشانهٔ هم‌جهت وجود دارد، اما شواهد کافی نیست.</p></article>
      <article><small>۰۳</small><h3>Confirmed · تأییدشده</h3><p>فقط پس از معیارهای چندمنبعی و کنترل کیفیت.</p></article>
    </div>
    <Panel tag="قواعد تحلیل" title="اصول غیرقابل مذاکره"><ul>
      <li>دادهٔ گم‌شده صفر نیست و به وضعیت سالم تبدیل نمی‌شود.</li>
      <li>زمان مشاهده با زمان جمع‌آوری یکی نیست؛ هر دو ثبت می‌شوند.</li>
      <li>دادهٔ ملی به استان، شهر یا اپراتور تعمیم داده نمی‌شود.</li>
      <li>یک شکست اتصال علت فیلترینگ، تحریم یا خاموشی را ثابت نمی‌کند.</li>
      <li>پیش‌بینی تا زمان داشتن تاریخچهٔ کافی فعال نیست.</li>
    </ul></Panel>
  </div>;

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><span><Activity size={22}/></span><div><b>NETGUARD</b><small>پایش اینترنت ایران</small></div></div>
      <label>مرکز پایش</label>
      <nav>{NAV.map(([id, title, Icon]) => <button key={id} className={id === page ? "selected" : ""} onClick={() => setPage(id)}><Icon size={18}/>{title}</button>)}</nav>
      <div className="sidefoot"><i/>{fmt(fresh)} منبع تازه از {fmt(data.sources.length)}<small>نسخه ۱٫۰ · NetGuard</small></div>
    </aside>
    <main>
      <header className="topbar"><div>نت‌گارد <b>/</b> <strong>{current[1]}</strong></div>
        <div className="actions"><span>ایران · ملی</span><button onClick={load} disabled={data.busy}><RefreshCw size={15}/>{data.busy ? "در حال دریافت" : "به‌روزرسانی"}</button></div>
      </header>
      <div className="content">
        {data.error && <div className="warning"><AlertTriangle/><div><b>اتصال داده هنوز کامل نشده است</b><p>{data.error} پس از اجرای SQL و افزودن کلید عمومی به Render، دادهٔ واقعی نمایش داده می‌شود؛ دادهٔ ساختگی نداریم.</p></div></div>}
        {body}
      </div>
      <footer><span>NetGuard · پایش شواهد عمومی</span><span>بازخوانی هر ۶۰ ثانیه · زمان منبع مستقل</span></footer>
    </main>
  </div>;
}
