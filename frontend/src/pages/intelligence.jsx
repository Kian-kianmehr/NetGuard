import React, { useMemo, useState } from "react";
import { deriveDisplayNationalSummary, describeCoverage } from "../public-status.js";
import { formatFaNumber as num, formatTime, safeText, asArray } from "../lib/data.js";
import { Badge, Card, DataBanner, DataMeta, EmptyState, LoadingState, Metric, Notice, SectionIntro, SelectTabs, Table } from "../components/ui.jsx";
import { SignalChart } from "../components/charts.jsx";

import { primaryNames, AiBrief, friendlySignalName, observationAgeText, explainSignalInPlainLanguage, buildPlainIntelligenceSummary, PlainForecastCard } from "./shared.jsx";


function AiQuestionPanel({ intelligence, plainSummary, models, forecast, cause, causeIsUnclear }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const suggestions = [
    "وضعیت فعلی اینترنت چطور است؟",
    "چه تغییر غیرعادی شناسایی شده؟",
    "پیش‌بینی نیم ساعت آینده چیست؟",
    "علت اختلال مشخص شده؟",
  ];

  const ask = (raw = question) => {
    const original = String(raw || "").trim();
    setQuestion(original);
    if (!original) {
      setAnswer({ text: "سؤال را بنویس یا یکی از پیشنهادها را انتخاب کن.", label: "منتظر پرسش" });
      return;
    }
    const q = original.replace(/[يى]/g, "ی").replace(/ك/g, "ک").toLowerCase();
    const ready = models.filter((item) => item.status === "ready");
    const anomalies = ready.filter((item) => item.is_anomaly);
    let text;
    let label = "پاسخ بر پایهٔ داده‌های پایش";

    if (/پیش.?بین|آینده|نیم.?ساعت|۳۰ دقیقه|روند/.test(q)) {
      text = forecastPlainDescription(forecast);
      if (!forecast?.available) text += " " + (forecast?.note || "در حال حاضر پیش‌بینی معتبر در خروجی مدل ثبت نشده است.");
    } else if (/علت|چرا|دلیل/.test(q)) {
      text = causeIsUnclear
        ? "با داده‌های فعلی علت مشخصی قابل تأیید نیست. مدل می‌تواند تغییر را شناسایی کند، اما بدون شواهد مستقل نمی‌توان آن را به خرابی زیرساخت، محدودیت دسترسی یا عامل دیگری نسبت داد."
        : (cause.description || cause.hypothesis_label || "یک فرضیه برای بررسی وجود دارد، اما این نتیجه تشخیص قطعی علت نیست.");
    } else if (/bgp|مسیر|مسیرها/.test(q)) {
      const item = models.find((entry) => entry.signal === "bgp");
      text = item ? explainSignalInPlainLanguage(item) : "برای شاخص BGP در این چرخه داده‌ای ثبت نشده است.";
    } else if (/پینگ|ping|پاسخ.?گوی|پاسخ.?ده/.test(q)) {
      const item = models.find((entry) => entry.signal === "ping-slash24");
      text = item ? explainSignalInPlainLanguage(item) : "برای شاخص پایش فعال شبکه در این چرخه داده‌ای ثبت نشده است.";
    } else if (/ناهنجار|غیر.?معمول|هشدار|تغییر/.test(q)) {
      text = anomalies.length
        ? "مدل در " + anomalies.map((item) => friendlySignalName(item.signal)).join("، ") + " تغییر غیرمعمول ثبت کرده است. این نشانه‌ها نیازمند بررسی‌اند و به‌تنهایی وقوع اختلال گسترده یا علت آن را ثابت نمی‌کنند."
        : ready.length
          ? "در شاخص‌های آماده، مدل در این چرخه تغییر غیرمعمولی علامت‌گذاری نکرده است. این نتیجه سلامت همهٔ مناطق و اپراتورها را تضمین نمی‌کند."
          : "هنوز شاخص آماده و دارای تاریخچهٔ کافی برای تشخیص ناهنجاری وجود ندارد.";
    } else if (/اطمینان|اعتماد|مطمئن/.test(q)) {
      const brief = intelligence?.analysis_brief || {};
      text = (brief.confidence_label ? "سطح اطمینان گزارش: " + brief.confidence_label + ". " : "")
        + (brief.limitations?.length ? "محدودیت‌ها: " + brief.limitations.join("؛ ") : "اطمینان به‌دلیل پوشش محدود داده‌ها باید محتاطانه تفسیر شود.");
    } else if (/وضعیت|اینترنت|اختلال|الان|فعلی|پایدار/.test(q)) {
      text = plainSummary.text || "برای جمع‌بندی وضعیت فعلی دادهٔ کافی در دسترس نیست.";
    } else {
      text = "این پرسش را نمی‌توان از داده‌های فعلی نت‌گارد با اطمینان پاسخ داد. دستیار به‌جای ساختن جواب، فقط دربارهٔ وضعیت فعلی، تغییرات غیرمعمول، شاخص‌های BGP و پینگ، پیش‌بینی و محدودیت شواهد پاسخ می‌دهد.";
      label = "محدودهٔ داده کافی نیست";
    }
    setAnswer({ text, label });
  };

  return (
    <Card className="ai-question-panel">
      <div className="ai-question-title"><span>✳</span> از تحلیل هوشمند نت‌گارد بپرس</div>
      <p>پاسخ‌ها از خروجی مدل‌های یادگیری ماشین و شواهد واقعی همین چرخه ساخته می‌شوند؛ اگر داده کافی نباشد، صریح اعلام می‌کنیم.</p>
      <form className="ai-question-form" onSubmit={(event) => { event.preventDefault(); ask(); }}>
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="مثلاً آیا در شاخص‌های اصلی تغییر غیرعادی دیده شده؟"
          aria-label="پرسش درباره وضعیت شبکه"
        />
        <button type="submit">تحلیل پرسش</button>
      </form>
      <div className="ai-question-prompts">
        {suggestions.map((prompt) => <button key={prompt} type="button" onClick={() => ask(prompt)}>{prompt}</button>)}
      </div>
      {answer && <div className="ai-question-answer" role="status" aria-live="polite"><small>{answer.label}</small><p>{answer.text}</p></div>}
    </Card>
  );
}

export function IntelligencePage({ record, status, onRetry }) {
  const intelligence = record?.intelligence || {};
  const forecast = intelligence.forecast || {};
  const components = asArray(forecast.components).filter((item) => item.available);
  const models = asArray(intelligence.signals);
  const cause = intelligence.cause_analysis || {};
  const recovery = intelligence.recovery_estimate || {};
  const plainSummary = buildPlainIntelligenceSummary(intelligence);
  const joint = intelligence.joint_model || {};
  const causeIsUnclear = !cause.hypothesis_id || cause.evidence_strength === "none" || cause.hypothesis_id === "insufficient_evidence";
  const anyAnomaly = models.some((item) => item.status === "ready" && item.is_anomaly) || Boolean(joint.available && joint.is_anomaly);
  const bgpModel = models.find((item) => item.signal === "bgp");
  const pingModel = models.find((item) => item.signal === "ping-slash24");
  const primaryReadyCount = [bgpModel, pingModel].filter((item) => item?.status === "ready").length;
  const primaryAnomalyCount = [bgpModel, pingModel].filter((item) => item?.status === "ready" && item.is_anomaly).length;
  const auxiliaryAnomalyCount = models.filter((item) => item.status === "ready" && item.is_anomaly && item.signal !== "bgp" && item.signal !== "ping-slash24").length;

  return (
    <div className="page-stack">
      <SectionIntro eyebrow="NetGuard Intelligence" title="هوش مصنوعی و پیش‌بینی">
        اینجا به‌جای دیدن صرفاً امتیاز مدل‌ها، می‌بینی چه تغییری در شبکه شناسایی شده، کدام شواهد آن را پشتیبانی می‌کنند و چه چیزهایی هنوز معلوم نیست.
      </SectionIntro>
      <DataBanner status={status} record={record} onRetry={onRetry} />

      <AiQuestionPanel
        intelligence={intelligence}
        plainSummary={plainSummary}
        models={models}
        forecast={forecast}
        cause={cause}
        causeIsUnclear={causeIsUnclear}
      />

      <Card className="ai-plain-overview">
        <div className="ai-plain-heading">
          <div>
            <span className="eyebrow">جمع‌بندی وضعیت فعلی</span>
            <h2>{plainSummary.title}</h2>
            <p>{plainSummary.text}</p>
          </div>
          <Badge tone={plainSummary.tone}>{plainSummary.label}</Badge>
        </div>

        <div className="ai-plain-signals">
          {models.length ? models.map((item) => {
            const flagged = item.status === "ready" && item.is_anomaly;
            const ready = item.status === "ready";
            const badgeLabel = !ready
              ? (item.status === "stale_data" ? "دادهٔ تازه نیست" : "هنوز آماده نیست")
              : flagged ? "تغییر غیرمعمول" : "در محدودهٔ معمول";
            return (
              <article className="ai-plain-signal" key={item.source_id}>
                <div className="ai-plain-signal-heading">
                  <strong>{friendlySignalName(item.signal)}</strong>
                  <Badge tone={!ready ? "muted" : flagged ? "warning" : "good"}>{badgeLabel}</Badge>
                </div>
                <p>{explainSignalInPlainLanguage(item)}</p>
                <small>{observationAgeText(item.observation_age_seconds)}</small>
              </article>
            );
          }) : <EmptyState title="هنوز نتیجه‌ای از مدل‌ها در دسترس نیست" detail="پس از آماده شدن داده‌های معتبر، برداشت سادهٔ وضعیت نمایش داده می‌شود." />}
        </div>

        <div className="ai-joint-explanation">
          <strong>آیا شاخص‌ها یک اتفاق مشترک را نشان می‌دهند؟</strong>
          <p>{joint.available
            ? (joint.is_anomaly
              ? "بله، مقایسهٔ هم‌زمان شاخص‌ها هم یک الگوی متفاوت از رفتار تاریخی پیدا کرده است. این موضوع نیاز به بررسی بیشتر دارد، اما علت اتفاق را مشخص نمی‌کند."
              : "فعلاً نه؛ وقتی شاخص‌ها در بازه‌های زمانی یکسان با هم مقایسه می‌شوند، الگوی کلی آن‌ها به رفتار معمول گذشته نزدیک است.")
            : "هنوز دادهٔ تازه و هم‌زمان کافی برای مقایسهٔ قابل اتکای شاخص‌ها وجود ندارد."}</p>
        </div>
      </Card>

      <Card title="تحلیل دقیق‌تر؛ این نشانه‌ها کنار هم چه می‌گویند؟" eyebrow="از مشاهده تا برداشت">
        <div className="ai-deep-analysis">
          <article>
            <span className="eyebrow">۱ · وضعیت شواهد اصلی</span>
            <p>{primaryReadyCount === 2
              ? primaryAnomalyCount === 2
                ? "هر دو ابزار اصلی پایش، تغییری بیرون از الگوی معمول خود ثبت کرده‌اند. وقتی دو روش مستقل در یک بازه تغییر نشان می‌دهند، احتمال اینکه با یک اتفاق مهم‌تر روبه‌رو باشیم بیشتر می‌شود؛ با این حال هنوز باید تداوم تغییر و داده‌های بعدی را دید."
                : primaryAnomalyCount === 1
                  ? "از دو ابزار اصلی، یکی تغییر غیرمعمول ثبت کرده و دیگری چنین تغییری نشان نداده است. این اختلاف مهم است: ممکن است تغییر فقط روی بخشی از شبکه یا در یکی از روش‌های اندازه‌گیری دیده شده باشد."
                  : "هر دو ابزار اصلی در محدودهٔ معمول خود هستند. این نشانه امیدوارکننده است، اما فقط می‌گوید در همین دو نوع اندازه‌گیری تغییر غیرعادی دیده نشده؛ نه اینکه اتصال همهٔ کاربران و همهٔ سرویس‌ها حتماً بدون مشکل باشد."
              : "در حال حاضر فقط " + num(primaryReadyCount, 0) + " مورد از دو ابزار اصلی دادهٔ آماده و قابل ارزیابی دارد. بنابراین تصویر ما از وضعیت شبکه کامل نیست و نبود هشدار را نباید معادل عادی بودن قطعی وضعیت دانست."}</p>
          </article>
          <article>
            <span className="eyebrow">۲ · نشانه‌های فرعی</span>
            <p>{auxiliaryAnomalyCount
              ? "در کنار شاخص‌های اصلی، " + num(auxiliaryAnomalyCount, 0) + " منبع فرعی هم رفتاری متفاوت ثبت کرده است. این داده می‌تواند سرنخ مفیدی باشد، اما چون ممکن است از تغییر ترافیک یا شرایط خود منبع تأثیر بگیرد، به‌تنهایی برای اعلام اختلال عمومی کافی نیست."
              : "در منابع فرعیِ آماده، نشانهٔ غیرعادی دیگری ثبت نشده است یا دادهٔ قابل استفاده‌ای برای چنین مقایسه‌ای وجود ندارد. منابع فرعی برای تکمیل تصویر مفیدند، اما جای شاخص‌های اصلی را نمی‌گیرند."}</p>
          </article>
          <article>
            <span className="eyebrow">۳ · نتیجهٔ مقایسهٔ هم‌زمان</span>
            <p>{joint.available
              ? joint.is_anomaly
                ? "مدل علاوه بر بررسی جداگانهٔ هر منبع، داده‌های هم‌زمان را هم کنار هم گذاشته و یک الگوی متفاوت پیدا کرده است. این موضوع وزن هشدار را بیشتر می‌کند، چون تغییر فقط در یک نمودار جداگانه دیده نشده است؛ اما همچنان علت را مشخص نمی‌کند."
                : "وقتی داده‌های هم‌زمان منابع با هم مقایسه شده‌اند، الگوی مشترک غیرعادی تشخیص داده نشده است. پس فعلاً شواهد برای تأیید یک تغییر هماهنگ در کل شبکه کافی نیست."
              : "این مقایسه هنوز انجام‌شدنی نیست؛ چون داده‌های منابع در زمان‌های نزدیک به هم و با تازگی کافی در دسترس نیستند. مقایسهٔ داده‌های مربوط به زمان‌های متفاوت می‌تواند برداشت اشتباه ایجاد کند."}</p>
          </article>
          <article>
            <span className="eyebrow">۴ · این نتیجه برای کاربران چه معنایی دارد؟</span>
            <p>این گزارش تصویری از چند شاخص ملی می‌دهد، نه آزمایش اتصال تک‌تک افراد. از آن نمی‌توان فهمید اینترنت یک شهر، اپراتور، خانه یا یک وب‌سایت مشخص حتماً قطع یا وصل است. برای چنین نتیجه‌ای به اندازه‌گیری از همان منطقه، اپراتور و مقصد نیاز داریم.</p>
          </article>
        </div>
      </Card>

      <PlainForecastCard forecast={forecast} />

      <Card title="علت اتفاق مشخص شده؟" eyebrow="آنچه هنوز نمی‌دانیم">
        {causeIsUnclear ? (
          <p>{anyAnomaly ? "داده‌های فعلی برای تشخیص علت کافی نیستند. یک تغییر غیرمعمول دیده شده، اما نمی‌توانیم آن را با اطمینان به خرابی زیرساخت، محدودیت دسترسی یا عامل مشخص دیگری نسبت بدهیم." : "فعلاً تغییر معناداری که بتوان علت مشخصی برای آن تعیین کرد در داده‌ها دیده نمی‌شود. با این حال، نبود نشانه در این مدل‌ها به معنی تضمین سلامت کامل اینترنت نیست."}</p>
        ) : (
          <>
            <h3>{cause.hypothesis_label || "یک احتمال برای بررسی وجود دارد"}</h3>
            <p>{cause.description || "این فقط یک فرضیه بر اساس هم‌زمانی تغییرات است و علت قطعی را مشخص نمی‌کند."}</p>
            <p className="scope-note">این برداشت یک فرضیه است و به معنی تشخیص قطعی علت نیست.</p>
          </>
        )}
        <div className="ai-recovery-note">
          <strong>زمان بازیابی</strong>
          <p>{recovery.available && recovery.estimated_duration_minutes != null
            ? "برآورد فعلی حدود " + num(recovery.estimated_duration_minutes, 0) + " دقیقه است و باید با داده‌های واقعی بعدی سنجیده شود."
            : "فعلاً قابل برآورد نیست. برای این کار به سابقهٔ رخدادهای تأییدشده با زمان شروع و پایان مشخص نیاز داریم."}</p>
        </div>
      </Card>

      <details className="ai-technical-details">
        <summary>
          <span>جزئیات فنی مدل‌ها و اعداد خام</span>
          <small>برای دیدن امتیازها، پیش‌بینی دقیق و روش مدل باز کن</small>
        </summary>
        <div className="ai-technical-content">
          <div className="metrics-grid">
            <Metric label="مدل تشخیص" value={safeText(intelligence.model_name, "در انتظار داده")} hint={intelligence.model_status_label || "مدل مستقل و چندشاخصی"} />
            <Metric label="امتیاز نشانه‌های افت" value={forecast.risk_index == null ? "—" : num(forecast.risk_index, 0) + " از ۱۰۰"} hint="امتیاز بررسی، نه احتمال اختلال" tone={forecast.available ? "warning" : "default"} />
            <Metric label="شاخص‌های آماده" value={num(intelligence.trained_signals, 0)} hint={"از " + num(models.length, 0) + " شاخص"} />
            <Metric label="امتیاز مدل چندشاخصی" value={joint.score == null ? "—" : num(joint.score, 3)} hint={joint.status_label || "تاریخچهٔ هم‌زمان لازم است"} />
          </div>
          <AiBrief intelligence={intelligence} />

          <Card title="پیش‌بینی دقیق مدل" eyebrow="۱۵، ۳۰ و ۶۰ دقیقه">
            {components.length ? <div className="forecast-grid">{components.map((item) => (
              <article className="forecast-card" key={item.signal}>
                <span className="eyebrow">{primaryNames[item.signal] || item.signal}</span>
                <h3>مقدار فعلی: {num(item.current_value, 2)}</h3>
                <div className="forecast-points">{asArray(item.horizon_projections).map((point) => (
                  <div key={point.minutes}><small>{num(point.minutes, 0)} دقیقهٔ آینده</small><b>{num(point.projected_value, 2)}</b><span>تغییر: {point.projected_change_percent == null ? "—" : num(point.projected_change_percent, 2) + "٪"}</span></div>
                ))}</div>
                <p>مدل: {item.forecast_model || "MLP"} · خطای اعتبارسنجی: {item.validation_mae_percent == null ? "—" : num(item.validation_mae_percent, 3) + "٪"}</p>
              </article>
            ))}</div> : <EmptyState title="پیش‌بینی قابل انتشار نیست" detail={forecast.note || "برای هر شاخص، دادهٔ تازه و تاریخچهٔ پیوسته لازم است."} />}
            <p className="scope-note">مدل MLP از ۱۲ مشاهدهٔ متوالی استفاده می‌کند و با جداسازی زمانی اعتبارسنجی می‌شود. اگر از خط مبنای ساده بهتر نباشد، پیش‌بینی منتشر نمی‌شود. خروجی احتمال کالیبره‌شده نیست.</p>
          </Card>

          <Card title="نتیجهٔ تفصیلی هر شاخص" eyebrow="تشخیص ناهنجاری مستقل">
            {models.length ? <div className="model-list">{models.map((item) => <article className="model-row" key={item.source_id}>
              <div><strong>{safeText(item.display_name, item.signal)}</strong><Badge tone={item.is_anomaly ? "warning" : item.status === "ready" ? "good" : "muted"}>{item.status_label || (item.is_anomaly ? "غیرمعمول" : "در حال یادگیری")}</Badge></div>
              <p>{safeText(item.interpretation, "توضیح مدل موجود نیست.")}</p>
              <small>{num(item.sample_count, 0)} نمونه · امتیاز {item.score == null ? "—" : num(item.score, 3)} · آخرین مشاهده {item.observation_age_seconds == null ? "نامشخص" : num(item.observation_age_seconds / 60, 0) + " دقیقه قبل"}</small>
            </article>)}</div> : <EmptyState title="تاریخچهٔ کافی موجود نیست" />}
          </Card>

          <Card title="جزئیات مقایسهٔ چندشاخصی" eyebrow="هم‌زمانی داده‌ها">
            <p>{joint.interpretation || joint.reason || "اطلاعاتی برای مقایسهٔ مشترک شاخص‌ها موجود نیست."}</p>
            <p className="scope-note">{joint.sample_count != null ? num(joint.sample_count, 0) + " بازهٔ هم‌تراز بررسی شده است." : "تعداد بازه‌های بررسی‌شده مشخص نیست."}</p>
          </Card>
        </div>
      </details>
    </div>
  );
}

