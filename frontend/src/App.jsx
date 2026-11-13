import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, BookOpen, CheckCircle2, Database, Globe2, RadioTower, RefreshCw, ShieldCheck, Signal } from "lucide-react";

const NAV = [
  ["overview", "نمای کلی", Globe2], ["analysis", "تحلیل وضعیت", Activity],
  ["signals", "سیگنال‌ها", Signal], ["events", "رخدادها", AlertTriangle],
  ["sources", "منابع داده", Database], ["method", "روش‌شناسی", BookOpen],
];
const API = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const number = (v) => v == null ? "—" : new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(Number(v));
const time = (v) => v ? new Intl.DateTimeFormat("fa-IR", { timeZone: "Asia/Tehran", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(v)) : "نامشخص";
const freshness = { fresh: ["تازه", "good"], stale: ["قدیمی", "warn"], degraded: ["دارای خطا", "warn"], unknown: ["نامشخص", "neutral"] };

function Badge({ value }) {
  const [label, tone] = freshness[value] || freshness.unknown;
  return <span className={"badge " + tone}><i />{label}</span>;
}
function Panel({ tag, title, note, children }) {
  return <section className="panel"><header><small>{tag}</small><h2>{title}</h2>{note && <p>{note}</p>}</header>{children}</section>;
}
function Empty({ title = "داده‌ای برای نمایش نیست", note = "پس از راه‌اندازی پایگاه داده و جمع‌آوری‌کننده، دادهٔ واقعی اینجا نمایش داده می‌شود." }) {
  return <div className="empty"><b>∅</b><strong>{title}</strong><p>{note}</p></div>;
}
function Table({ rows }) {
  if (!rows.length) return <Empty title="هنوز داده‌ای از منابع دریافت نشده" />;
  return <div className="table-wrap"><table><thead><tr><th>منبع</th><th>وضعیت</th><th>آخرین مشاهده</th><th>آخرین اجرا</th><th>مقدار</th></tr></thead>
    <tbody>{rows.map((s) => <tr key={s.source_id}>
      <td><b>{s.display_name}</b><small>{s.provider} · {s.signal}</small></td>
      <td><Badge value={s.freshness_status} /></td>
      <td>{time(s.last_observed_at)}<small>{s.observation_age_seconds == null ? "نامشخص" : number(Math.floor(s.observation_age_seconds / 60)) + " دقیقه پیش"}</small></td>
      <td>{time(s.last_run_started_at)}<small>{s.last_run_status || "بدون اجرا"}</small></td>
      <td><b>{number(s.latest_value)}</b><small>{s.unit}</small></td>
    </tr>)}</tbody></table></div>;
}
function Chart({ rows }) {
  const valid = rows.filter((r) => r.quality === "valid" && Number.isFinite(Number(r.value)));
  if (!valid.length) return <Empty title="هنوز تاریخچه‌ای ثبت نشده" />;
  const values = valid.map((r) => Number(r.value));
  const lo = Math.min(...values), span = Math.max(Math.max(...values) - lo, 0.000001);
  const points = valid.map((r, i) => {
    const x = 20 + i / Math.max(1, valid.length - 1) * 860;
    const y = 170 - (Number(r.value) - lo) / span * 140;
    return x + "," + y;
  }).join(" ");
  return <div className="chart"><svg viewBox="0 0 900 190" preserveAspectRatio="none">
    <line x1="20" x2="880" y1="30" y2="30"/><line x1="20" x2="880" y1="100" y2="100"/><line x1="20" x2="880" y1="170" y2="170"/>
    <polyline points={points} fill="none" stroke="#63d7b7" strokeWidth="3"/>
  </svg><div className="axis"><span>{time(valid[0].observed_at)}</span><span>{time(valid.at(-1).observed_at)}</span></div></div>;
}
function detectChanges(sources, groups) {
  return sources.flatMap((source) => {
    const rows = (groups[source.source_id] || []).filter((x) => x.quality === "valid");
    if (rows.length < 15) return [];
    const baseline = rows.slice(-15, -3).map((x) => Number(x.value)).sort((a, b) => a - b);
    const median = baseline[Math.floor(baseline.length / 2)];
    if (!Number.isFinite(median) || Math.abs(median) < 1e-9) return [];
    const current = rows.slice(-3).reduce((sum, x) => sum + Number(x.value), 0) / 3;
    const change = (current - median) / Math.abs(median) * 100;
    return Math.abs(change) >= 25 ? [{ source, change, at: rows.at(-1).observed_at }] : [];
  });
}

export default function App() {
  const [page, setPage] = useState("overview");
  const [data, setData] = useState({ sources: [], observations: [], generated_at: null, error: "", busy: true });
  const load = useCallback(async () => {
    if (!API) { setData((v) => ({ ...v, busy: false, error: "آدرس API در متغیر VITE_API_URL سایت Render تنظیم نشده است." })); return; }
    setData((v) => ({ ...v, busy: true }));
    try {
      const response = await fetch(API + "/api/dashboard?hours=168", { headers: { Accept: "application/json" }, cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "دریافت داده ناموفق بود: " + response.status);
      setData({ ...payload, error: "", busy: false });
    } catch (error) {
      setData((v) => ({ ...v, busy: false, error: error.message || "ارتباط با API برقرار نشد." }));
    }
  }, []);
  useEffect(() => {
    let active = true, timer;
    const tick = async () => { if (!active) return; if (document.visibilityState === "visible") await load(); if (active) timer = setTimeout(tick, 60000); };
    tick();
    return () => { active = false; clearTimeout(timer); };
  }, [load]);

  const groups = useMemo(() => data.observations.reduce((acc, row) => {
    (acc[row.source_id] ||= []).push(row); return acc;
  }, {}), [data.observations]);
  const anomalies = useMemo(() => detectChanges(data.sources, groups), [data.sources, groups]);
  const counts = data.sources.reduce((acc, source) => {
    acc[source.freshness_status] = (acc[source.freshness_status] || 0) + 1; return acc;
  }, {});
  const fresh = counts.fresh || 0;
  const attention = (counts.stale || 0) + (counts.degraded || 0);
  const overall = !data.sources.length ? "نامشخص" : fresh ? "دریافت داده فعال" : "داده نیازمند بررسی";
  const current = NAV.find((item) => item[0] === page) || NAV[0];
  let body;

  if (page === "overview") body = <>
    <div className="hero"><div><small>مرکز پایش ملی · ایران</small><h2>{overall}</h2>
      <p>{number(fresh)} منبع تازه · {number(attention)} منبع قدیمی یا خطادار</p>
      <div className="meta"><span>آخرین مشاهده: {time(data.sources.map((s) => s.last_observed_at).filter(Boolean).sort().at(-1))}</span><span>آخرین دریافت API: {time(data.generated_at)}</span></div>
    </div><div className="orb"><Globe2 size={40}/><b>IR</b></div></div>
    <div className="metrics">{[[RadioTower,"منابع ثبت‌شده",data.sources.length],[CheckCircle2,"منابع تازه",fresh],[AlertTriangle,"قدیمی یا خطادار",attention],[Activity,"مشاهدات هفت روز",data.observations.length]].map(([Icon,label,value]) => <article key={label}><Icon/><small>{label}</small><b>{number(value)}</b><em>دادهٔ ثبت‌شده</em></article>)}</div>
    <div className="columns"><Panel tag="روند سیگنال‌ها" title="تاریخچهٔ اندازه‌گیری" note="مقیاس هر منبع مستقل است."><Chart rows={data.observations}/></Panel>
      <Panel tag="شواهد اولیه" title="موارد نیازمند بررسی">{anomalies.length ? anomalies.map((event) => <div className="event" key={event.source.source_id}><AlertTriangle/><div><b>{event.source.display_name}</b><p>{event.change < 0 ? "کاهش" : "افزایش"} {number(Math.abs(event.change))}٪ نسبت به مبنا</p><small>{time(event.at)}</small></div></div>) : <Empty title="انحراف آماری ثبت نشده" note="این نتیجه سلامت کل اینترنت را ثابت نمی‌کند."/>}</Panel>
    </div>
    <Panel tag="سلامت ورودی داده" title="وضعیت منابع"><Table rows={data.sources}/></Panel>
  </>;
  else if (page === "analysis") body = <div className="stack"><div className="intro"><small>تحلیل وضعیت</small><h2>چه چیزی را اکنون می‌دانیم؟</h2><p>مشاهدهٔ مستقیم از تفسیر احتمالی جداست؛ علت اختلال فقط با شواهد مستقل و چندمنبعی بررسی می‌شود.</p></div>
    <div className="summary"><ShieldCheck/><div><b>{overall}</b><p>{fresh} منبع تازه از {data.sources.length} منبع ثبت‌شده</p></div></div>
    <div className="three"><article><small>مشاهده‌شده</small><h3>وضعیت منابع</h3><p>{number(fresh)} منبع دادهٔ تازه دارند.</p></article><article><small>نیازمند بررسی</small><h3>{number(anomalies.length)} انحراف اولیه</h3><p>تغییر آماری یک منبع رخداد قطعی نیست.</p></article><article><small>علت‌یابی</small><h3>نتیجه‌گیری نمی‌شود</h3><p>یک آزمون منفرد فیلترینگ، تحریم یا خاموشی را ثابت نمی‌کند.</p></article></div></div>;
  else if (page === "signals") body = <div className="stack"><div className="intro"><small>سیگنال‌ها</small><h2>جزئیات اندازه‌گیری‌ها</h2><p>هر منبع واحد و روش مخصوص خود را دارد؛ مقادیر ناهم‌واحد را مستقیم مقایسه نکنید.</p></div>
    {data.sources.map((source) => <Panel key={source.source_id} tag={source.provider + " · " + source.signal} title={source.display_name} note={source.description}><Badge value={source.freshness_status}/><div className="details"><div><small>آخرین مقدار</small><b>{number(source.latest_value)}</b><em>{source.unit}</em></div><div><small>آخرین مشاهده</small><b>{time(source.last_observed_at)}</b><em>{source.observation_age_seconds == null ? "نامشخص" : number(Math.floor(source.observation_age_seconds / 60)) + " دقیقه پیش"}</em></div><div><small>رکوردهای هفت روز</small><b>{number((groups[source.source_id] || []).length)}</b></div></div><Chart rows={groups[source.source_id] || []}/><a href={source.source_url} target="_blank" rel="noreferrer">مستندات منبع ↗</a></Panel>)}
    {!data.sources.length && <Empty/>}</div>;
  else if (page === "events") body = <div className="stack"><div className="intro"><small>رخدادها</small><h2>موارد نیازمند بررسی</h2><p>در نسخهٔ اول فقط انحراف آماری دیده می‌شود؛ رخداد چندمنبعی به‌عنوان قطعی تأیید نمی‌شود.</p></div>
    {anomalies.length ? anomalies.map((event) => <Panel key={event.source.source_id} tag="Observed · نیازمند بررسی" title={event.source.display_name} note={(event.change < 0 ? "کاهش" : "افزایش") + " " + number(Math.abs(event.change)) + "٪ نسبت به مبنا · " + time(event.at)}><Badge value="degraded"/></Panel>) : <Empty title="موردی بالاتر از آستانه پیدا نشد" note="این به معنی نبود اختلال نیست؛ پوشش محدود منابع را در نظر بگیرید."/>}</div>;
  else if (page === "sources") body = <div className="stack"><div className="intro"><small>منابع داده</small><h2>منابع فعال نسخهٔ اول</h2><p>سه سیگنال ملی IODA در pipeline تعریف شده‌اند؛ منابع دیگر هنوز متصل نشده‌اند.</p></div>
    <Panel tag="ثبت منابع" title="فهرست و تازگی داده"><Table rows={data.sources}/></Panel>
    <div className="three"><article><b>IODA · Georgia Tech</b><p>منبع اصلی سیگنال‌های زیرساختی نسخهٔ نخست.</p><a href="https://api.ioda.inetintel.cc.gatech.edu/v2/docs" target="_blank" rel="noreferrer">مستندات API ↗</a></article><article><b>RouteViews</b><p>شواهد مکمل مسیرها؛ هنوز متصل نشده.</p><a href="https://www.routeviews.org/" target="_blank" rel="noreferrer">وب‌سایت ↗</a></article><article><b>OONI</b><p>منبع مکمل بررسی دسترسی؛ منبع پنج‌دقیقه‌ای نیست.</p><a href="https://measurements.ooni.org/" target="_blank" rel="noreferrer">پرتال داده ↗</a></article></div></div>;
  else body = <div className="stack"><div className="intro"><small>روش‌شناسی</small><h2>داده چه می‌گوید و چه چیزی را ثابت نمی‌کند؟</h2><p>شفافیت منبع، زمان و محدودیت‌ها بخشی از محصول است.</p></div>
    <div className="three"><article><small>۰۱</small><h3>Observed · مشاهده‌شده</h3><p>مقدار، زمان و منبعی که مستقیم دریافت و ذخیره شده است.</p></article><article><small>۰۲</small><h3>Suspected · مشکوک</h3><p>چند نشانهٔ هم‌جهت وجود دارد، اما شواهد کافی نیست.</p></article><article><small>۰۳</small><h3>Confirmed · تأییدشده</h3><p>فقط پس از معیارهای چندمنبعی و کنترل کیفیت.</p></article></div>
    <Panel tag="قواعد تحلیل" title="اصول غیرقابل مذاکره"><ul><li>دادهٔ گم‌شده صفر نیست و به وضعیت سالم تبدیل نمی‌شود.</li><li>زمان مشاهده با زمان جمع‌آوری یکی نیست؛ هر دو ثبت می‌شوند.</li><li>دادهٔ ملی به استان، شهر یا اپراتور تعمیم داده نمی‌شود.</li><li>یک شکست اتصال علت فیلترینگ، تحریم یا خاموشی را ثابت نمی‌کند.</li><li>پیش‌بینی تا زمان داشتن تاریخچهٔ کافی فعال نیست.</li></ul></Panel></div>;

  return <div className="app"><aside className="sidebar"><div className="brand"><span><Activity size={22}/></span><div><b>NETGUARD</b><small>پایش اینترنت ایران</small></div></div><label>مرکز پایش</label>
    <nav>{NAV.map(([id,title,Icon]) => <button key={id} className={id === page ? "selected" : ""} onClick={() => setPage(id)}><Icon size={18}/>{title}</button>)}</nav>
    <div className="sidefoot"><i/>{number(fresh)} منبع تازه از {number(data.sources.length)}<small>نسخه ۱٫۰ · NetGuard</small></div></aside>
    <main><header className="topbar"><div>نت‌گارد <b>/</b> <strong>{current[1]}</strong></div><div className="actions"><span>ایران · ملی</span><button onClick={load} disabled={data.busy}><RefreshCw size={15}/>{data.busy ? "در حال دریافت" : "به‌روزرسانی"}</button></div></header>
      <div className="content">{data.error && <div className="warning"><AlertTriangle/><div><b>اتصال داده هنوز کامل نشده است</b><p>{data.error} پس از تنظیم متغیرهای Supabase در سرویس API، دادهٔ واقعی نمایش داده می‌شود؛ دادهٔ ساختگی نداریم.</p></div></div>}{body}</div>
      <footer><span>NetGuard · پایش شواهد عمومی</span><span>بازخوانی هر ۶۰ ثانیه · زمان منبع مستقل</span></footer></main></div>;
}
