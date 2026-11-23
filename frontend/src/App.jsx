import React, { useEffect, useState } from "react";
import { useNetguardData } from "./lib/data.js";
import PageContent from "./pages/index.jsx";

const NAVIGATION = [
  { id: "overview", label: "مرکز هوشمند", glyph: "✳", group: "مرکز هوشمند" },
  { id: "quality", label: "کیفیت داده", glyph: "▦", group: "پایش" },
  { id: "signals", label: "سیگنال‌ها", glyph: "⌁", group: "پایش" },
  { id: "analysis", label: "تحلیل وضعیت", glyph: "◉", group: "تحلیل" },
  { id: "intelligence", label: "مدل‌ها و تحلیل AI", glyph: "◉", group: "مرکز هوشمند" },
  { id: "events", label: "دفتر رخدادها", glyph: "!", group: "تحلیل" },
  { id: "censorship", label: "وب و فیلترینگ", glyph: "◎", group: "زیرساخت" },
  { id: "providers", label: "دیتاسنترها و سرویس‌ها", glyph: "▤", group: "زیرساخت" },
  { id: "sources", label: "منابع داده", glyph: "◈", group: "سامانه" },
  { id: "method", label: "روش‌شناسی", glyph: "≡", group: "سامانه" },
];

const PAGE_TITLES = Object.fromEntries(NAVIGATION.map((item) => [item.id, item.label]));

export default function App() {
  const [page, setPage] = useState("overview");
  const [hours, setHours] = useState(24);
  const { items, statuses, load, refreshPage } = useNetguardData();

  useEffect(() => {
    document.documentElement.dataset.netguardReady = "true";
    load(["dashboard_24", "intelligence_24", "censorship", "providers_status", "iran_datacenters"]);
    const refresh = () => {
      if (document.visibilityState === "visible") {
        load(["dashboard_24", "intelligence_24", "censorship", "providers_status", "iran_datacenters"]);
      }
    };
    const interval = window.setInterval(refresh, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  useEffect(() => {
    if (page === "method") return;
    refreshPage(page, hours, false);
  }, [page, hours, refreshPage]);

  const navigate = (nextPage) => {
    if (!PAGE_TITLES[nextPage]) return;
    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const refreshCurrent = () => {
    if (page === "overview") return load(["dashboard_" + hours, "intelligence_" + hours], true);
    if (page === "censorship") return refreshPage(page, hours, true);
    if (page === "providers") return refreshPage(page, hours, true);
    return refreshPage(page, hours, true);
  };

  const dashboard = items["dashboard_" + hours];
  const activeStatus = page === "censorship" ? statuses.censorship
    : page === "providers" ? statuses.providers_status
      : page === "intelligence" ? statuses["intelligence_" + hours]
        : page === "method" ? null : statuses["dashboard_" + hours];

  return (
    <div className="app-shell" dir="rtl">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-symbol">NG<span /></div>
          <div><strong>NETGUARD</strong><small>مرکز پایش اینترنت ایران</small></div>
        </div>
        <div className="sidebar-caption">فضای کاری</div>
        <nav className="main-nav" aria-label="بخش‌های نت‌گارد">
          {["مرکز هوشمند", "پایش", "تحلیل", "زیرساخت", "سامانه"].map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-group-label">{group}</span>
              {NAVIGATION.filter((item) => item.group === group).map((item) => (
                <button key={item.id} type="button" className={"nav-link " + (page === item.id ? "active" : "")} onClick={() => navigate(item.id)} aria-current={page === item.id ? "page" : undefined}>
                  <span className="nav-glyph">{item.glyph}</span><span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="live-indicator"><i /> پایش خودکار</span>
          <p>دادهٔ عمومی · بدون تخمین ساختگی</p>
          <small>NetGuard <span>نسخهٔ ۲</span></small>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>نت‌گارد</span><b>/</b><strong>{PAGE_TITLES[page]}</strong></div>
          <div className="topbar-actions">
            <span className="scope-chip"><i /> ایران · مقیاس ملی</span>
            <button type="button" className="refresh-button" onClick={refreshCurrent} disabled={Boolean(activeStatus?.loading)}>
              <span className={activeStatus?.loading ? "refresh-glyph spinning" : "refresh-glyph"}>↻</span>
              {activeStatus?.loading ? "در حال دریافت" : "به‌روزرسانی"}
            </button>
          </div>
        </header>
        <div className="page-container">
          <PageContent
            page={page}
            items={items}
            statuses={statuses}
            hours={hours}
            onHours={(value) => setHours(Number(value))}
            onRefresh={load}
            onNavigate={navigate}
          />
        </div>
        <footer className="app-footer">
          <span>NETGUARD <i>·</i> پایش شواهد عمومی وضعیت اینترنت</span>
          <span>بازخوانی خودکار هر ۵ دقیقه · زمان نمایش تهران</span>
        </footer>
      </main>
    </div>
  );
}
