import test from "node:test";
import assert from "node:assert/strict";
import { describeCoverage, deriveDisplayNationalSummary, deriveLimitedNationalVerdict } from "../src/public-status.js";

const pingStable = {
  signal: "ping-slash24",
  data_state: "usable",
  freshness_status: "fresh",
  current_anomaly: false,
};
const bgpStale = {
  signal: "bgp",
  data_state: "stale",
  freshness_status: "stale",
  current_anomaly: false,
};

test("one fresh stable primary signal yields a qualified stable verdict", () => {
  const result = deriveLimitedNationalVerdict({ bgp: bgpStale, ping: pingStable });
  assert.equal(result.condition, "stable_limited");
  assert.equal(result.title, "وضعیت کلی اینترنت فعلاً پایدار است");
  assert.equal(result.confidence_label, "محدود");
  assert.match(result.outage_detail, /BGP/);
});

test("a fresh anomalous primary signal never gets labelled stable", () => {
  const result = deriveLimitedNationalVerdict({
    ping: { ...pingStable, current_anomaly: true },
    bgp: bgpStale,
  });
  assert.equal(result.condition, "attention");
});

test("stale or missing primary signals remain indeterminate", () => {
  const result = deriveLimitedNationalVerdict({ bgp: bgpStale });
  assert.equal(result.condition, "unknown");
});

test("two fresh primary signals with no anomaly can be described as stable with limited fallback confidence", () => {
  const result = deriveLimitedNationalVerdict({
    bgp: { ...bgpStale, data_state: "usable", freshness_status: "fresh" },
    ping: pingStable,
  });
  assert.equal(result.condition, "stable_limited");
});

test("analysis view uses the same qualified verdict as the public report", () => {
  const summary = { condition: "unknown", title: "old indeterminate title", tone: "neutral" };
  const result = deriveDisplayNationalSummary(summary, [bgpStale, pingStable]);
  assert.equal(result.condition, "stable_limited");
  assert.equal(result.title, "وضعیت کلی اینترنت فعلاً پایدار است");
});

test("coverage explicitly names the seven-day window and explains its denominator", () => {
  const result = describeCoverage({
    window_hours: 168,
    valid_observations: 283,
    expected_observations: 5040,
  });
  assert.equal(result.windowLabel, "۷ روزه");
  assert.match(result.detail, /۲۸۳/);
  assert.match(result.detail, /۵٬۰۴۰/);
  assert.match(result.detail, /نه درصد کاربران/);
});
