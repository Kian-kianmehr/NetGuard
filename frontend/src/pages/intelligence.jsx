import React, { useMemo, useState } from "react";
import { deriveDisplayNationalSummary, describeCoverage } from "../public-status.js";
import { formatFaNumber as num, formatTime, safeText, asArray } from "../lib/data.js";
import { Badge, Card, DataBanner, DataMeta, EmptyState, LoadingState, Metric, Notice, SectionIntro, SelectTabs, Table } from "../components/ui.jsx";
import { SignalChart } from "../components/charts.jsx";

import { primaryNames, AiBrief, friendlySignalName, observationAgeText, explainSignalInPlainLanguage, buildPlainIntelligenceSummary, PlainForecastCard, forecastPlainDescription } from "./shared.jsx";


export function AiQuestionPanel({ intelligence, plainSummary, models, forecast, cause, causeIsUnclear }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const suggestions = [
    "نیم ساعت آینده چه می‌شود؟",
    "وضعیت فعلی اینترنت ایران چطور است؟",
    "کدام شاخص تغییر غیرعادی دارد؟",
    "وضعیت BGP و مسیرهای اینترنت چیست؟",
    "تلسکوپ شبکه چه چیزی نشان می‌دهد؟",
    "پینگ در چه وضعیتی است؟",
    "چرا ممکن است اختلال رخ داده باشد؟",
    "دقت و محدودیت پیش‌بینی چقدر است؟",
  ];

  const answerQuestion = (raw) => {
    const original = String(raw || "").trim();
    if (!original) return null;
    const q = original.replace(/[يى]/g, "ی").replace(/ك/g, "ک").toLowerCase();
    const ready = models.filter((item) => item.status === "ready");
    const anomalies = models.filter((item) => item.is_anomaly);
    const availableForecasts = asArray(forecast?.components).filter((item) => item.available);
    const forecastLine = (item, minutes) => {
      const point = asArray(item.horizon_projections).find((entry) => Number(entry.minutes) === minutes)
        || asArray(item.horizon_projections).find((entry) => Number(entry.minutes) === 30);
      if (!point) return null;
      const direction = Number(point.projected_change_percent) > 0.1 ? "افزایش"
        : Number(point.projected_change_percent) < -0.1 ? "کاهش" : "تقریباً ثابت";
      return friendlySignalName(item.signal) + ": مقدار فعلی " + num(item.current_value, 2)
        + "؛ مقدار پیش‌بینی‌شده " + num(point.projected_value, 2)
        + " (" + direction + " " + num(Math.abs(Number(point.projected_change_percent) || 0), 2) + "٪).";
    };
    const forecastAnswer = (minutes) => {
      const lines = availableForecasts.map((item) => forecastLine(item, minutes)).filter(Boolean);
      if (lines.length) {
        return "پیش‌بینی مدل برای " + num(minutes, 0) + " دقیقهٔ آینده بر اساس آخرین بستهٔ تحلیل:\n\n"
          + lines.join("\n")
          + "\n\nاین خروجی برآورد روند شاخص‌هاست، نه احتمال قطعی قطع اینترنت. اعتبار آن به کیفیت داده و خطای اعتبارسنجی هر مدل وابسته است.";
      }
      const partial = forecastPlainDescription(forecast || {});
      const reasons = asArray(forecast?.components).map((item) => item.reason).filter(Boolean);
      return partial + (reasons.length ? "\n\nجزئیات: " + [...new Set(reasons)].join("؛ ") : "")
        + "\n\nآخرین تحلیل ذخیره‌شده خروجی عددی قابل انتشار برای این افق ندارد؛ عددی را حدس نمی‌زنم. می‌توانی از دکمهٔ به‌روزرسانی استفاده کنی تا آخرین Snapshot دریافت شود.";
    };
    const findSignal = (signal) => models.find((item) => item.signal === signal);
    const signalAnswer = (item) => item
      ? friendlySignalName(item.signal) + "\n" + explainSignalInPlainLanguage(item)
        + "\nمقدار فعلی: " + num(item.current_value, 2)
        + " · تعداد نمونه: " + num(item.sample_count, 0)
        + " · سن آخرین مشاهده: " + observationAgeText(item.observation_age_seconds)
        + " · سن آخرین جمع‌آوری: " + observationAgeText(item.collection_age_seconds) + "."
      : "برای این شاخص در Snapshot فعلی داده‌ای ثبت نشده است.";
    let text = "";
    let label = "تحلیل بر پایهٔ داده‌های NETGUARD";
    if (/پیش.?بین|آینده|نیم.?ساعت|نیم ساعت|۳۰ دقیقه|30 دقیقه|یک ساعت|۶۰ دقیقه|60 دقیقه|۱۵ دقیقه|15 دقیقه/.test(q)) {
      const minutes = /۶۰|60|یک ساعت/.test(q) ? 60 : /۱۵|15/.test(q) ? 15 : 30;
      text = forecastAnswer(minutes);
      label = "خروجی مدل پیش‌بینی";
    } else if (/bgp|مسیر|مسیرها|دیدپذیری/.test(q)) {
      text = signalAnswer(findSignal("bgp"));
    } else if (/تلسکوپ|merit|هانی.?پات/.test(q)) {
      text = signalAnswer(findSignal("merit-nt"));
    } else if (/پینگ|ping|پاسخ.?گوی|پاسخ.?ده/.test(q)) {
      text = signalAnswer(findSignal("ping-slash24"));
    } else if (/علت|چرا|دلیل|منشا|منشأ/.test(q)) {
      text = causeIsUnclear
        ? "با شواهد فعلی علت مشخصی قابل تأیید نیست. مدل می‌تواند هم‌زمانی یا تغییر شاخص‌ها را نشان دهد، اما برای نسبت دادن آن به خرابی زیرساخت، محدودیت دسترسی یا عامل دیگر به شواهد مستقل نیاز داریم."
        : (cause.description || cause.hypothesis_label || "یک فرضیه برای بررسی وجود دارد؛ این فرضیه تشخیص قطعی علت نیست.");
    } else if (/ناهنجار|غیر.?معمول|هشدار|تغییر|افت|کاهش|افزایش/.test(q)) {
      text = anomalies.length
        ? "این شاخص‌ها از الگوی تاریخی خود فاصله گرفته‌اند: " + anomalies.map((item) => friendlySignalName(item.signal)).join("، ")
          + ".\n\n" + anomalies.map((item) => friendlySignalName(item.signal) + ": " + explainSignalInPlainLanguage(item)).join("\n")
          + "\n\nناهنجاری آماری به‌تنهایی به معنی اختلال سراسری یا اثبات علت نیست."
        : ready.length
          ? "در شاخص‌های آمادهٔ فعلی ناهنجاری‌ای از آستانهٔ مدل عبور نکرده است. این نتیجه سلامت همهٔ مناطق و اپراتورها را تضمین نمی‌کند."
          : "هنوز مدل‌ها تاریخچهٔ کافی برای تشخیص ناهنجاری ندارند.";
    } else if (/اطمینان|اعتماد|دقت|خطا|محدودیت|اعتبار/.test(q)) {
      const brief = intelligence?.analysis_brief || {};
      const errors = availableForecasts.map((item) => friendlySignalName(item.signal) + ": خطای اعتبارسنجی "
        + (item.validation_mae_percent == null ? "ثبت نشده" : num(item.validation_mae_percent, 3) + "٪")
        + " و مهارت نسبت به خط مبنا "
        + (item.model_skill_percent == null ? "ثبت نشده" : num(item.model_skill_percent, 2) + "٪"));
      text = (brief.confidence_label ? "سطح اطمینان گزارش: " + brief.confidence_label + ".\n" : "")
        + (errors.length ? errors.join("\n") + "\n" : "")
        + (asArray(brief.limitations).length ? "محدودیت‌ها: " + brief.limitations.join("؛ ") : "پیش‌بینی قطعی نیست و با تغییر شرایط شبکه ممکن است خطا کند.");
    } else if (/نمونه|داده|جمع.?آوری|کالکتور|منبع|تازگ|قدیم/.test(q)) {
      text = models.length
        ? models.map((item) => friendlySignalName(item.signal) + ": " + num(item.sample_count, 0) + " نمونه؛ آخرین جمع‌آوری " + observationAgeText(item.collection_age_seconds) + "؛ آخرین مشاهده " + observationAgeText(item.observation_age_seconds)).join("\n")
        : "در Snapshot فعلی اطلاعات شاخص‌ها در دسترس نیست.";
    } else if (/وضعیت|اینترنت|اختلال|الان|فعلی|پایدار|ایران/.test(q)) {
      text = (plainSummary?.text || "برای جمع‌بندی وضعیت فعلی دادهٔ کافی در دسترس نیست.")
        + (anomalies.length ? "\n\nشاخص‌های نیازمند توجه: " + anomalies.map((item) => friendlySignalName(item.signal)).join("، ") : "")
        + "\n\nاین جمع‌بندی در مقیاس ملی است و وضعیت اتصال یک شهر، اپراتور یا کاربر را به‌تنهایی مشخص نمی‌کند.";
    } else if (/بیشتر|توضیح|چطور|چگونه|یعنی چه/.test(q) && messages.length) {
      text = "جزئیات بیشتر بر اساس داده‌های فعلی:\n" + (plainSummary?.text || "جمع‌بندی وضعیت در دسترس نیست.")
        + "\n\n" + ready.map((item) => friendlySignalName(item.signal) + ": " + explainSignalInPlainLanguage(item)).join("\n");
    } else {
      text = "این سؤال را دریافت کردم، اما برای اینکه پاسخ ساختگی ندهم باید موضوع آن به یکی از داده‌ها و خروجی‌های موجود متصل باشد. می‌توانم دربارهٔ وضعیت کلی اینترنت، پیش‌بینی ۱۵/۳۰/۶۰ دقیقه‌ای، BGP، تلسکوپ Merit، Ping، ناهنجاری‌ها، علت‌های احتمالی، تازگی داده و دقت مدل تحلیل بدهم.\n\nاگر منظورت موضوع دیگری است، کمی دقیق‌تر بپرس یا یکی از پرسش‌های پیشنهادی را انتخاب کن.";
      label = "نیاز به مشخص شدن موضوع";
    }
    return { text, label };
  };

  const ask = (raw = question) => {
    const original = String(raw || "").trim();
    if (!original || busy) return;
    setQuestion("");
    setBusy(true);
    const result = answerQuestion(original);
    if (result) setMessages((current) => [...current, { id: Date.now(), question: original, ...result }].slice(-12));
    setBusy(false);
  };

  return (
    <Card className="ai-question-panel">
      <div className="ai-question-title"><span>✳</span> دستیار تحلیلی NETGUARD</div>
      <p>سؤال دلخواهت را بپرس یا از پرسش‌های آماده استفاده کن. پاسخ‌ها از Snapshot شبکه، خروجی مدل‌های یادگیری ماشین و شواهد ثبت‌شده ساخته می‌شوند؛ اگر داده برای نتیجه‌گیری کافی نباشد، صریح می‌گوییم.</p>
      <form className="ai-question-form" onSubmit={(event) => { event.preventDefault(); ask(); }}>
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="مثلاً نیم ساعت آینده چه تغییری در BGP و پینگ می‌بینیم؟"
          aria-label="پرسش درباره وضعیت شبکه"
        />
        <button type="submit" disabled={!question.trim() || busy}>{busy ? "در حال تحلیل…" : "ارسال پرسش"}</button>
      </form>
      <div className="ai-question-prompts">
        {suggestions.map((prompt) => <button key={prompt} type="button" onClick={() => ask(prompt)}>{prompt}</button>)}
      </div>
      <div className="ai-chat-history" aria-live="polite">
        {messages.map((message) => (
          <div className="ai-chat-turn" key={message.id}>
            <div className="ai-chat-user"><span>شما</span><p>{message.question}</p></div>
            <div className="ai-question-answer"><small>{message.label}</small><p>{message.text}</p></div>
          </div>
        ))}
      </div>
      <small className="ai-assistant-footnote">پاسخ‌گو به داده‌های پایش و مدل‌های فعلی NETGUARD متصل است؛ برای موضوعات خارج از این داده‌ها ادعای دانستن نمی‌کند.</small>
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

