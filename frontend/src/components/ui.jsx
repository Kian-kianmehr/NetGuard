import React from "react";

export function Card({ children, className = "", title, eyebrow, subtitle, action }) {
  return (
    <section className={"card " + className}>
      {(title || eyebrow || subtitle || action) && (
        <header className="card-head">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action && <div className="card-action">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ children, tone = "muted" }) {
  return <span className={"badge badge-" + tone}><i />{children}</span>;
}

export function Metric({ label, value, hint, icon = "◈", tone = "default" }) {
  return (
    <article className={"metric metric-" + tone}>
      <div className="metric-top"><span>{label}</span><b aria-hidden="true">{icon}</b></div>
      <strong>{value ?? "—"}</strong>
      {hint && <small>{hint}</small>}
    </article>
  );
}

export function EmptyState({ title = "داده‌ای برای نمایش نیست", detail = "پس از دریافت دادهٔ معتبر، این بخش به‌روزرسانی می‌شود." }) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">∅</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function Notice({ title, children, tone = "info" }) {
  return (
    <div className={"notice notice-" + tone} role="note">
      <span aria-hidden="true">{tone === "warning" ? "!" : "i"}</span>
      <div><strong>{title}</strong><p>{children}</p></div>
    </div>
  );
}

export function SectionIntro({ eyebrow, title, children, action }) {
  return (
    <div className="section-intro">
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{children}</p></div>
      {action && <div className="section-intro-action">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = "در حال دریافت داده..." }) {
  return <div className="loading-state"><span className="spinner" /><span>{label}</span></div>;
}

export function DataBanner({ status, record, onRetry }) {
  if (!status?.loading && !status?.error && !status?.stale) return null;
  if (!record && status?.loading) return <div className="data-banner"><span className="spinner spinner-small" /> در حال دریافت اطلاعات این بخش...</div>;
  return (
    <div className={"data-banner " + (status?.error ? "data-banner-warning" : "")}>
      <span>{status?.error ? "!" : "◷"}</span>
      <div>
        <strong>{status?.error ? "به‌روزرسانی با مشکل روبه‌رو شد" : "آخرین داده قدیمی است"}</strong>
        <p>{status?.error || "اطلاعات ذخیره‌شده نمایش داده می‌شود؛ این داده ممکن است وضعیت همین لحظه را نشان ندهد."}</p>
      </div>
      {onRetry && <button type="button" onClick={onRetry}>تلاش دوباره</button>}
    </div>
  );
}

export function DataMeta({ record, status }) {
  return (
    <div className="data-meta">
      <span>آخرین Snapshot: {record?.snapshot_at ? new Intl.DateTimeFormat("fa-IR", { timeZone: "Asia/Tehran", dateStyle: "medium", timeStyle: "short" }).format(new Date(record.snapshot_at)) : "نامشخص"}</span>
      {status?.source === "live" && <span className="meta-live">دریافت تازه</span>}
      {record?.snapshot_status === "partial" && <span className="meta-warning">داده ناقص</span>}
    </div>
  );
}

export function Table({ columns, rows, rowKey, emptyTitle = "موردی ثبت نشده", emptyDetail }) {
  if (!rows?.length) return <EmptyState title={emptyTitle} detail={emptyDetail} />;
  return (
    <div className="table-scroll">
      <table>
        <thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey ? rowKey(row) : (row.id || row.source_id || row.domain || row.event_id || index)}>
              {columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : (row[column.key] ?? "—")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SelectTabs({ value, onChange, options, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={String(option.value)} type="button" className={value === option.value ? "active" : ""} onClick={() => onChange(option.value)} aria-pressed={value === option.value}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
