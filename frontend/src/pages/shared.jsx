import React, { useMemo, useState } from "react";
import { deriveDisplayNationalSummary, describeCoverage } from "../public-status.js";
import { formatFaNumber as num, formatTime, safeText, asArray } from "../lib/data.js";
import { Badge, Card, DataBanner, DataMeta, EmptyState, LoadingState, Metric, Notice, SectionIntro, SelectTabs, Table } from "../components/ui.jsx";
import { SignalChart } from "../components/charts.jsx";

export const primaryNames = { bgp: "دیدپذیری مسیرهای اینترنت (BGP)", "ping-slash24": "پایش فعال شبکه", "merit-nt": "تلسکوپ شبکه (Merit)" };
export const severity = {
  critical: ["بحرانی", "danger"], high: ["زیاد", "danger"],
  warning: ["هشدار", "warning"], info: ["اطلاع", "muted"],
};
export const freshness = {
  fresh: ["تازه", "good"], delayed: ["با تأخیر", "warning"],
  stale: ["قدیمی", "warning"], degraded: ["دارای خطا", "danger"],
  unknown: ["نامشخص", "muted"],
};
export const providerStatus = {
  operational: ["عادی", "good"], degraded_performance: ["افت عملکرد", "warning"],
  partial_outage: ["اختلال بخشی", "danger"], major_outage: ["اختلال گسترده", "danger"],
  under_maintenance: ["تعمیر و نگهداری", "warning"], unknown: ["نامشخص", "muted"],
};

export function toneForCondition(condition) {
  if (condition === "possible_disruption" || condition === "elevated_attention") return "danger";
  if (condition === "attention" || condition === "watch") return "warning";
  if (condition === "stable" || condition === "stable_limited" || condition === "no_anomaly_detected") return "good";
  return "muted";
}

export function SignalStatus({ value }) {
  const [label, tone] = freshness[value] || freshness.unknown;
  return <Badge tone={tone}>{label}</Badge>;
}

export function ConditionCard({ summary, checkedAt }) {
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

export function SignalSummaryCard({ signal, observations }) {
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

export function AiBrief({ intelligence }) {
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

export function ProviderCard({ item }) {
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

export function friendlySignalName(signal) {
  if (signal === "bgp") return "دیدپذیری مسیرهای اینترنت (BGP)";
  if (signal === "ping-slash24") return "پایش فعال شبکه";
  if (signal === "merit-nt") return "تلسکوپ شبکه";
  return "این شاخص";
}

export function observationAgeText(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return "زمان آخرین مشاهده مشخص نیست";
  const minutes = Math.max(0, Math.round(Number(seconds) / 60));
  return minutes < 1 ? "آخرین مشاهده کمتر از یک دقیقه پیش بوده" : "آخرین مشاهده حدود " + num(minutes, 0) + " دقیقه پیش بوده";
}

export function explainSignalInPlainLanguage(item) {
  const name = friendlySignalName(item.signal);
  if (item.status !== "ready") {
    if (item.status === "stale_data") {
      return name + " دادهٔ تازه‌ای برای ارزیابی وضعیت همین لحظه ندارد. " + observationAgeText(item.observation_age_seconds) + ".";
    }
    return "برای " + name + " هنوز تاریخچهٔ پیوسته و کافی جهت ارزیابی قابل اتکا فراهم نشده است.";
  }

  if (item.is_anomaly) {
    if (item.signal === "merit-nt") {
      return "تلسکوپ شبکه نسبت به گذشته الگوی متفاوتی از نشانی‌های اینترنتی دیده است. این تغییر ممکن است به تغییر ترافیک یا پوشش خود تلسکوپ مربوط باشد و به‌تنهایی به معنی اختلال اینترنت نیست.";
    }
    return "رفتار این شاخص با الگوی معمول گذشته تفاوت دارد و برای بررسی علامت‌گذاری شده است. این نتیجه به‌تنهایی وقوع اختلال یا علت آن را ثابت نمی‌کند.";
  }

  if (item.signal === "bgp") {
    return "تعداد مسیرهای اینترنتی قابل مشاهده در محدودهٔ معمول تاریخچه است و مدل در این شاخص تغییر غیرعادی پیدا نکرده است.";
  }
  if (item.signal === "ping-slash24") {
    return "تعداد شبکه‌هایی که از نقاط پایش فعال پاسخ می‌دهند در محدودهٔ معمول تاریخچه است و مدل تغییر غیرعادی پیدا نکرده است.";
  }
  if (item.signal === "merit-nt") {
    return "رفتار ثبت‌شدهٔ تلسکوپ شبکه به الگوی معمول گذشته نزدیک است.";
  }
  return "مدل در این شاخص تفاوت غیرعادی با رفتار معمول گذشته پیدا نکرده است.";
}

export function buildPlainIntelligenceSummary(intelligence) {
  const models = asArray(intelligence.signals);
  const ready = models.filter((item) => item.status === "ready");
  const anomalies = ready.filter((item) => item.is_anomaly);
  const primary = {
    bgp: models.find((item) => item.signal === "bgp"),
    ping: models.find((item) => item.signal === "ping-slash24"),
  };
  const primaryAnomalies = anomalies.filter((item) => item.signal === "bgp" || item.signal === "ping-slash24");
  const auxiliaryAnomalies = anomalies.filter((item) => item.signal !== "bgp" && item.signal !== "ping-slash24");
  const bothPrimaryReady = primary.bgp?.status === "ready" && primary.ping?.status === "ready";
  const joint = intelligence.joint_model || {};
  const jointAnomaly = joint.available && joint.is_anomaly;

  if (!ready.length) {
    return {
      title: "هنوز دادهٔ کافی برای جمع‌بندی نداریم",
      text: "مدل‌ها برای قضاوت دربارهٔ وضعیت فعلی به مشاهده‌های تازه و تاریخچهٔ پیوسته نیاز دارند. تا فراهم شدن این داده‌ها، نتیجهٔ قطعی نمایش داده نمی‌شود.",
      label: "دادهٔ ناکافی",
      tone: "muted",
    };
  }

  if (primaryAnomalies.length === 2) {
    return {
      title: "در هر دو شاخص اصلی تغییر غیرمعمول دیده شده",
      text: "هم دیدپذیری مسیرهای اینترنت و هم پایش فعال شبکه از الگوی معمول خود فاصله گرفته‌اند. هم‌زمانی این دو نشانه مهم است، اما برای اعلام اختلال قطعی یا تعیین علت آن هنوز باید شواهد بیشتری بررسی شود.",
      label: "نیازمند بررسی جدی‌تر",
      tone: "warning",
    };
  }

  if (primaryAnomalies.length === 1) {
    const changed = primaryAnomalies[0];
    const other = changed.signal === "bgp" ? primary.ping : primary.bgp;
    const otherName = friendlySignalName(other?.signal || (changed.signal === "bgp" ? "ping-slash24" : "bgp"));
    const otherExplanation = other?.status === "ready"
      ? " در مقابل، " + otherName + " فعلاً در محدودهٔ معمول است."
      : " اما دادهٔ تازه و قابل ارزیابی از شاخص دیگر در دسترس نیست.";
    return {
      title: "در " + friendlySignalName(changed.signal) + " یک تغییر غیرمعمول دیده شده",
      text: "مدل در این شاخص تفاوتی با رفتار گذشته پیدا کرده است." + otherExplanation + " بنابراین این مشاهده به‌تنهایی برای نتیجه‌گیری دربارهٔ اختلال گسترده کافی نیست.",
      label: "نیازمند بررسی",
      tone: "warning",
    };
  }

  if (auxiliaryAnomalies.length && bothPrimaryReady) {
    return {
      title: "یک تغییر در تلسکوپ شبکه دیده شده، اما شاخص‌های اصلی عادی‌اند",
      text: "تلسکوپ شبکه رفتاری متفاوت از گذشته ثبت کرده است، ولی دیدپذیری مسیرهای اینترنت و پایش فعال شبکه فعلاً تغییر غیرعادی نشان نمی‌دهند. این وضعیت می‌تواند به تغییر ترافیک یا پوشش تلسکوپ مربوط باشد و فعلاً نشانهٔ کافی برای اعلام اختلال گسترده نداریم.",
      label: "تغییر محدود به یک منبع",
      tone: "warning",
    };
  }

  if (jointAnomaly) {
    return {
      title: "مقایسهٔ هم‌زمان شاخص‌ها یک الگوی غیرمعمول پیدا کرده",
      text: "وقتی داده‌های چند شاخص در بازه‌های زمانی یکسان کنار هم قرار گرفته‌اند، الگویی متفاوت از تاریخچه دیده شده است. این یک علامت برای بررسی بیشتر است و علت یا وقوع قطعی اختلال را مشخص نمی‌کند.",
      label: "نیازمند بررسی",
      tone: "warning",
    };
  }

  if (bothPrimaryReady) {
    return {
      title: "در دو شاخص اصلی تغییر غیرمعمولی دیده نشده",
      text: "دیدپذیری مسیرهای اینترنت و پاسخ‌گویی شبکه از دید مدل نزدیک به الگوی معمول خود هستند. این نتیجه فقط دربارهٔ همین شاخص‌های ملی است و سلامت همهٔ اپراتورها یا مناطق را تضمین نمی‌کند.",
      label: "در محدودهٔ معمول",
      tone: "good",
    };
  }

  return {
    title: "فقط بخشی از وضعیت شبکه قابل ارزیابی است",
    text: "برای بعضی شاخص‌ها داده و نتیجهٔ قابل استفاده وجود دارد، اما شواهد هم‌زمان کافی برای جمع‌بندی کامل وضعیت شبکه فراهم نیست.",
    label: "ارزیابی محدود",
    tone: "muted",
  };
}

export function forecastChangeText(item) {
  const points = asArray(item.horizon_projections);
  const point = points.find((entry) => Number(entry.minutes) === 30);
  const raw = point?.projected_change_percent ?? item.projected_change_30m_percent;
  if (raw == null || !Number.isFinite(Number(raw))) return "برای این شاخص پیش‌بینی قابل انتشار نیست";
  const change = Number(raw);
  if (Math.abs(change) <= 0.1) return "تقریباً بدون تغییر";
  return (change < 0 ? "کاهش حدود " : "افزایش حدود ") + num(Math.abs(change), 2) + "٪";
}

export function forecastPlainDescription(forecast) {
  if (!forecast.available) {
    const available = asArray(forecast.components).filter((item) => item.available);
    if (available.length) {
      return "فعلاً فقط " + available.map((item) => friendlySignalName(item.signal)).join(" و ") + " برای پیش‌بینی آماده است. برای یک جمع‌بندی قابل اتکا از روند شاخص‌های اصلی، دادهٔ تازه از هر دو شاخص لازم است.";
    }
    return "مدل در حال حاضر پیش‌بینی قابل اتکایی منتشر نکرده است. برای این کار به دادهٔ تازه و پیوسته از شاخص‌های اصلی نیاز است.";
  }
  if (forecast.risk_level === "elevated") {
    return "مدل نشانه‌های افت پررنگ‌تری در روند شاخص‌های اصلی دیده و بررسی نزدیک‌تر را پیشنهاد می‌کند. این نتیجه به معنی تأیید اختلال نیست.";
  }
  if (forecast.risk_level === "watch") {
    return "چند نشانه برای پیگیری دقیق‌تر وجود دارد، اما مدل فعلاً وقوع اختلال را تأیید نمی‌کند.";
  }
  return "بر اساس روند فعلی دو شاخص اصلی، مدل در بازهٔ پیش‌بینی نشانه‌ای از افت پرقدرت نمی‌بیند.";
}

export function PlainForecastCard({ forecast }) {
  const available = asArray(forecast.components).filter((item) => item.available);
  return (
    <Card title="در ۳۰ دقیقهٔ آینده چه انتظاری داریم؟" eyebrow="پیش‌بینی به زبان ساده">
      {available.length ? (
        <>
          <div className="ai-forecast-plain-grid">
            {available.map((item) => (
              <article className="ai-forecast-plain-item" key={item.signal}>
                <span>{friendlySignalName(item.signal)}</span>
                <strong>{forecastChangeText(item)}</strong>
                <small>این برآورد فقط دربارهٔ مقدار همین شاخص است</small>
              </article>
            ))}
          </div>
          <p className="ai-forecast-explanation">{forecastPlainDescription(forecast)}</p>
        </>
      ) : (
        <EmptyState title="فعلاً پیش‌بینی قابل اتکایی نداریم" detail={forecastPlainDescription(forecast)} />
      )}
      <p className="scope-note">پیش‌بینی دربارهٔ روند هر شاخص است، نه درصد احتمال قطعی یا اختلال اینترنت.</p>
    </Card>
  );
}
