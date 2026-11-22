import React, { useMemo, useState } from "react";
import { deriveDisplayNationalSummary, describeCoverage } from "../public-status.js";
import { formatFaNumber as num, formatTime, safeText, asArray } from "../lib/data.js";
import { Badge, Card, DataBanner, DataMeta, EmptyState, LoadingState, Metric, Notice, SectionIntro, SelectTabs, Table } from "../components/ui.jsx";
import { SignalChart } from "../components/charts.jsx";

import {  } from "./shared.jsx";

export function MethodPage() {
  return (
    <div className="page-stack">
      <SectionIntro eyebrow="روش‌شناسی و محدودیت‌ها" title="نت‌گارد چگونه نتیجه می‌گیرد؟">
        هر نتیجه باید قابل ردیابی به منبع، زمان، کیفیت نمونه و محدودیت اندازه‌گیری باشد.
      </SectionIntro>
      <div className="method-grid">
        <article><span>۰۱</span><h3>دریافت شواهد</h3><p>Collectorهای زمان‌بندی‌شده داده‌های IODA، آزمون‌های OONI و صفحه‌های رسمی وضعیت سرویس‌ها را ذخیره می‌کنند.</p></article>
        <article><span>۰۲</span><h3>کنترل کیفیت</h3><p>زمان مشاهده، زمان دریافت، cadence، نمونه‌های نامعتبر و شکاف داده جداگانه بررسی می‌شوند.</p></article>
        <article><span>۰۳</span><h3>تحلیل و مدل</h3><p>خط مبنا و ناهنجاری هر شاخص مستقل محاسبه می‌شود؛ پیش‌بینی فقط با تاریخچهٔ کافی و ارزیابی زمانی منتشر می‌شود.</p></article>
        <article><span>۰۴</span><h3>جمع‌بندی محتاطانه</h3><p>وضعیت ملی از کنار هم گذاشتن شاخص‌های اصلی به دست می‌آید. یک مشاهدهٔ منفرد، علت اختلال را مشخص نمی‌کند.</p></article>
      </div>
      <Card title="قواعد تفسیر" eyebrow="اصول ثابت">
        <ul className="simple-list">
          <li>دادهٔ گم‌شده صفر نیست و نشانهٔ سلامت شبکه محسوب نمی‌شود.</li>
          <li>زمان مشاهده با زمان جمع‌آوری یکی نیست؛ هر دو باید حفظ شوند.</li>
          <li>دادهٔ ملی به استان، شهر یا اپراتور تعمیم داده نمی‌شود.</li>
          <li>یک خطای اتصال یا کاهش یک شاخص، علت فیلترینگ، تحریم یا خاموشی را ثابت نمی‌کند.</li>
          <li>عددهای شاخص‌هایی با واحد متفاوت با هم جمع یا مقایسه نمی‌شوند.</li>
          <li>امتیاز ناهنجاری و ریسک، احتمال کالیبره‌شدهٔ اختلال نیست.</li>
          <li>فهرست Citizen Lab فقط نامزد آزمون است؛ نتیجهٔ OONI جداگانه ارزیابی می‌شود.</li>
          <li>وضعیت جهانی سرویس‌ها، دسترسی کاربران ایران به آن‌ها را اثبات نمی‌کند.</li>
          <li>موجودی دیتاسنترها وضعیت روشن/خاموش یا سلامت عملیاتی آن‌ها را نشان نمی‌دهد.</li>
        </ul>
      </Card>
      <Notice title="محدودیت جغرافیایی">نسخهٔ فعلی پایش ملی دارد، نه probe مستقل در تمام استان‌ها و اپراتورها. به همین دلیل نقشهٔ استانی و رتبه‌بندی ISP از این داده‌ها قابل استنتاج نیست.</Notice>
    </div>
  );
}

