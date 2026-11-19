import React from "react";
import { formatFaNumber, formatTime } from "../lib/data.js";

function pointsFor(rows, width, height) {
  const values = rows.map((row) => Number(row.value)).filter(Number.isFinite);
  if (values.length < 2) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const valid = rows.map((row) => ({ row, value: Number(row.value) })).filter((item) => Number.isFinite(item.value));
  return valid.map((item, index) => ({
    x: 8 + (index / Math.max(1, valid.length - 1)) * (width - 16),
    y: height - 12 - ((item.value - min) / spread) * (height - 24),
    value: item.value,
    time: item.row.observed_at,
  }));
}

export function Sparkline({ rows = [], height = 58 }) {
  const points = pointsFor(rows, 320, height);
  if (points.length < 2) return <div className="chart-empty">برای رسم نمودار، دو مشاهدهٔ معتبر لازم است.</div>;
  const line = points.map((point) => point.x + "," + point.y).join(" ");
  const area = "8," + (height - 2) + " " + line + " 312," + (height - 2);
  return (
    <svg className="sparkline" viewBox={"0 0 320 " + height} role="img" aria-label="نمودار روند اندازه‌گیری">
      <line x1="8" y1={height / 2} x2="312" y2={height / 2} className="chart-gridline" />
      <polygon points={area} className="chart-area" />
      <polyline points={line} className="chart-line" />
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3.5" className="chart-point" />
    </svg>
  );
}

export function SignalChart({ rows = [] }) {
  const sorted = [...rows].sort((a, b) => Date.parse(a.observed_at || 0) - Date.parse(b.observed_at || 0));
  const points = pointsFor(sorted, 640, 180);
  if (points.length < 2) return <div className="chart-empty chart-large-empty">دادهٔ زمانی کافی برای رسم نمودار وجود ندارد.</div>;
  const line = points.map((point) => point.x + "," + point.y).join(" ");
  const area = "8,168 " + line + " 632,168";
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <div className="signal-chart">
      <div className="chart-extremes"><span>شروع: {formatFaNumber(first.value, 2)}</span><span>اکنون: {formatFaNumber(last.value, 2)}</span></div>
      <svg viewBox="0 0 640 180" role="img" aria-label="روند تاریخی شاخص">
        <line x1="8" y1="40" x2="632" y2="40" className="chart-gridline" />
        <line x1="8" y1="90" x2="632" y2="90" className="chart-gridline" />
        <line x1="8" y1="140" x2="632" y2="140" className="chart-gridline" />
        <polygon points={area} className="chart-area" />
        <polyline points={line} className="chart-line" />
        <circle cx={last.x} cy={last.y} r="4" className="chart-point" />
      </svg>
      <div className="chart-extremes"><span>{formatTime(first.time)}</span><span>{formatTime(last.time)}</span></div>
    </div>
  );
}
