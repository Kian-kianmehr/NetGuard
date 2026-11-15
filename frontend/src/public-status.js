const PRIMARY_SIGNALS = ["bgp", "ping-slash24"];

export function deriveLimitedNationalVerdict({ bgp, ping } = {}) {
  const primary = [bgp, ping].filter(Boolean);
  const usable = primary.filter(
    (item) => item.data_state === "usable" && item.freshness_status === "fresh"
  );
  const anomalous = usable.filter((item) => item.current_anomaly === true);
  const usableNames = usable.map((item) =>
    item.signal === "bgp" ? "دیدپذیری مسیرهای اینترنت" : "پاسخ‌گویی شبکه در پایش فعال"
  );
  const missingNames = PRIMARY_SIGNALS
    .filter((signal) => !usable.some((item) => item.signal === signal))
    .map((signal) => signal === "bgp" ? "BGP" : "پایش فعال");

  if (anomalous.length) {
    const names = anomalous.map((item) =>
      item.signal === "bgp" ? "دیدپذیری مسیرهای اینترنت" : "پایش فعال شبکه"
    );
    return {
      condition: "attention",
      tone: "warn",
      title: "یک شاخص اصلی تغییر غیرعادی نشان می‌دهد",
      condition_label: "نیازمند بررسی",
      stability_label: "در یک شاخص اصلی تغییر غیرعادی ثبت شده",
      outage_label: "اختلال گسترده هنوز تأیید نشده",
      outage_state: "single_signal_anomaly",
      outage_detail: `در ${names.join(" و ")} تغییر غیرعادی ثبت شده است. این شاخص به‌تنهایی برای اعلام اختلال گسترده کافی نیست و باید با شواهد مستقل بررسی شود.`,
      confidence_label: "محدود",
      summary: `در ${names.join(" و ")} تغییر غیرعادی دیده شده است؛ بنابراین فعلاً وضعیت را پایدار اعلام نمی‌کنیم. این مشاهده به‌تنهایی اختلال سراسری را اثبات نمی‌کند.`,
    };
  }

  if (usable.length) {
    const sourceText = usableNames.join(" و ");
    const limitation = missingNames.length
      ? ` شاخص ${missingNames.join(" و ")} در حال حاضر دادهٔ تازه و قابل استفاده ندارد.`
      : " با وجود دادهٔ قابل استفاده، پوشش این ارزیابی همچنان محدود است.";
    return {
      condition: "stable_limited",
      tone: "good",
      title: "وضعیت کلی اینترنت فعلاً پایدار است",
      condition_label: "فعلاً پایدار · اطمینان محدود",
      stability_label: `در ${sourceText} افت غیرعادی ثبت نشده`,
      outage_label: "نشانه‌ای از اختلال گسترده در شاخص تازه دیده نشده",
      outage_state: "no_current_primary_anomaly_limited",
      outage_detail: `در ${sourceText} افت غیرعادی ثبت نشده است.${limitation} این نتیجه نشانهٔ نبود شواهد کافی از اختلال گسترده است، نه اثبات سلامت کامل اینترنت یا تجربهٔ یکسان همهٔ کاربران.`,
      confidence_label: "محدود",
      summary: `در ${sourceText} دادهٔ تازه و قابل استفاده وجود دارد و افت غیرعادی ثبت نشده است.${limitation} بنابراین وضعیت فعلی را «فعلاً پایدار با اطمینان محدود» ارزیابی می‌کنیم؛ این نتیجه سلامت کامل همهٔ شبکه‌ها و کاربران را اثبات نمی‌کند.`,
    };
  }

  return {
    condition: "unknown",
    tone: "neutral",
    title: "وضعیت کلی اینترنت فعلاً قابل تعیین نیست",
    condition_label: "دادهٔ تازهٔ کافی نداریم",
    stability_label: "برای ارزیابی پایداری دادهٔ تازهٔ کافی نداریم",
    outage_label: "نه پایداری و نه اختلال گسترده قابل تأیید نیست",
    outage_state: "insufficient_data",
    outage_detail: "هیچ‌یک از دو شاخص اصلی در حال حاضر دادهٔ تازه و قابل استفادهٔ کافی ندارد؛ بنابراین اعلام پایداری یا اختلال گسترده قابل اتکا نیست.",
    confidence_label: "بسیار محدود",
    summary: "دادهٔ تازه و قابل استفاده از شاخص‌های اصلی برای اعلام پایداری یا اختلال گسترده کافی نیست. نبود داده به معنی سالم بودن شبکه نیست.",
  };
}

export function deriveDisplayNationalSummary(summary, signals = []) {
  if (!summary || summary.condition !== "unknown") return summary;
  const bgp = signals.find((item) => item.signal === "bgp");
  const ping = signals.find((item) => item.signal === "ping-slash24");
  return { ...summary, ...deriveLimitedNationalVerdict({ bgp, ping }) };
}
