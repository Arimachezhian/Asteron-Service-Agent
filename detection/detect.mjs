/**
 * detect.mjs
 *
 * Stage 1 of the pipeline (README.md's diagram): rule-based, no AI.
 * Threshold flags only — service overdue, no first-service booked, app
 * inactivity, approaching/past warranty expiry — exactly the four
 * signals PROJECT_HANDOFF.md §4 names for this stage. This is the
 * concrete answer to Reality 2 ("not everything needs AI") one level
 * before diagnosis even starts: nothing here requires judgment, so
 * nothing here calls an LLM.
 *
 * Reads data/customers.json (the full synthetic base), writes
 * data/flagged_customers.json (only the subset that trips at least one
 * threshold, each tagged with which threshold(s) fired). The dashboard
 * and the /diagnose calls only ever see this filtered list — an agent
 * that re-diagnoses every customer nightly regardless of whether
 * anything changed would waste API calls for no reason.
 *
 * Run: node detection/detect.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { SERVICE_INTERVAL_MONTHS_BY_CATEGORY, TYPICAL_WARRANTY_MONTHS } from "../src/completeness_check.js";

function monthsBetween(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function computeFlags(record, today) {
  const flags = [];
  const interval = SERVICE_INTERVAL_MONTHS_BY_CATEGORY[record.vehicle_category] ?? 6;
  const vehicleAgeMonths = record.purchase_date ? monthsBetween(record.purchase_date, today) : null;

  // Service overdue.
  if (record.last_service_date) {
    const monthsSinceService = monthsBetween(record.last_service_date, today);
    if (monthsSinceService > interval * 1.5) {
      flags.push(`service_overdue: ${monthsSinceService}mo since last service (expected every ${interval}mo)`);
    }
  } else if (record.service_visit_count === 0 && vehicleAgeMonths !== null && vehicleAgeMonths >= interval) {
    flags.push(`never_serviced: ${vehicleAgeMonths}mo since purchase, first service expected within ${interval}mo`);
  }

  // No first-service booked at delivery.
  if (record.first_service_booked_at_delivery === false && vehicleAgeMonths !== null && vehicleAgeMonths >= 1) {
    flags.push("no_first_service_booked_at_delivery");
  }
  if (
    (record.first_service_booked_at_delivery === null || record.first_service_booked_at_delivery === undefined) &&
    record.service_visit_count === 0
  ) {
    flags.push("delivery_booking_status_unknown");
  }

  // App inactivity — matches the case's own "<40% active after year 1" figure.
  if (!record.app_last_login_date) {
    if (vehicleAgeMonths !== null && vehicleAgeMonths >= 12) flags.push("app_never_used_past_year_1");
  } else {
    const monthsSinceLogin = monthsBetween(record.app_last_login_date, today);
    if (monthsSinceLogin >= 12) flags.push(`app_inactive_${monthsSinceLogin}mo`);
  }

  // Approaching or past typical warranty expiry.
  if (vehicleAgeMonths !== null) {
    const warrantyRemaining = TYPICAL_WARRANTY_MONTHS - vehicleAgeMonths;
    if (warrantyRemaining <= 3 && warrantyRemaining >= 0) {
      flags.push(`warranty_expiring_in_${warrantyRemaining}mo`);
    } else if (warrantyRemaining < 0) {
      flags.push(`warranty_expired_${Math.abs(warrantyRemaining)}mo_ago`);
    }
  }

  // Any complaint or low survey score is itself a reason to route through
  // diagnosis, independent of the threshold checks above.
  if ((record.complaint_text?.length ?? 0) > 0) flags.push("has_complaint_on_record");
  if ((record.survey_scores ?? []).some((s) => s.score <= 3)) flags.push("low_survey_score_on_record");

  return flags;
}

const today = new Date().toISOString().slice(0, 10);
const customers = JSON.parse(readFileSync(new URL("../data/customers.json", import.meta.url)));

const flagged = [];
for (const record of customers) {
  const flags = computeFlags(record, today);
  if (flags.length > 0) {
    const { _demo_intent, ...cleanRecord } = record;
    flagged.push({ customer_id: record.customer_id, flags, record: cleanRecord });
  }
}

const output = {
  generated_at: new Date().toISOString(),
  as_of_date: today,
  total_customers: customers.length,
  flagged_count: flagged.length,
  flagged
};

writeFileSync(new URL("../data/flagged_customers.json", import.meta.url), JSON.stringify(output, null, 2) + "\n");

console.log(`Detection run complete: ${flagged.length}/${customers.length} customers flagged.`);
for (const f of flagged) {
  console.log(`  ${f.customer_id}: ${f.flags.join(", ")}`);
}
