import test from "node:test";
import assert from "node:assert/strict";
import { deriveLimitedNationalVerdict } from "../src/public-status.js";

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
