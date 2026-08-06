/**
 * completeness_check.js
 *
 * Runs BEFORE the LLM call. This is deliberately plain, deterministic
 * code, not an LLM call — inference from correlated fields (e.g. service
 * interval from vehicle category) needs to be auditable and consistent,
 * not left to model discretion. The LLM only ever sees a record that has
 * already been through this pass, with every field tagged.
 *
 * Ported from reasoning-core/completeness_check.js — logic is identical,
 * only the export style changed (CommonJS -> ESM) so it can be imported
 * directly by the Worker's index.js.
 *
 * Exports:
 *   checkCompleteness(rawRecord) -> {
 *     record: taggedRecord,
 *     needsHumanInput: boolean,
 *     humanQuestion: string | null,
 *     skipLLM: boolean   // true when a critical field is missing and
 *                         // unresolvable — saves an API call entirely
 *   }
 */

// Genuinely correlated defaults used only to fill soft-required gaps.
// These are documented, inspectable assumptions, not invented guesses.
// NOTE: illustrative defaults for the demo — a production build would
// source these from Asteron's actual service-schedule tables per model.
export const SERVICE_INTERVAL_MONTHS_BY_CATEGORY = {
  hatchback: 6,
  sedan: 6,
  suv: 6,
  ev: 12
};

export const TYPICAL_WARRANTY_MONTHS = 36;

// Fields the agent cannot proceed without at all.
const HARD_REQUIRED_FIELDS = ["customer_id", "vehicle_category"];

function monthsBetween(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function tagField(value, isInferred, basis) {
  return {
    value,
    status: value === null || value === undefined ? "missing" : (isInferred ? "inferred" : "observed"),
    basis: isInferred ? basis : undefined
  };
}

export function checkCompleteness(raw) {
  const missingHard = HARD_REQUIRED_FIELDS.filter((f) => raw[f] === undefined || raw[f] === null);
  if (missingHard.length > 0) {
    return {
      record: null,
      needsHumanInput: true,
      humanQuestion: `Record for ${raw.customer_id || "this customer"} is missing required field(s): ${missingHard.join(", ")}. Please supply before this record can be assessed.`,
      skipLLM: true
    };
  }

  const today = raw.as_of_date || new Date().toISOString().slice(0, 10);
  const tagged = {};

  // Direct pass-through fields, tagged observed if present.
  tagged.customer_id = tagField(raw.customer_id, false);
  tagged.vehicle_category = tagField(raw.vehicle_category, false);
  tagged.purchase_date = tagField(raw.purchase_date, false);
  tagged.last_service_date = tagField(raw.last_service_date ?? null, false);
  tagged.service_visit_count = tagField(raw.service_visit_count ?? 0, false);
  tagged.complaint_text = tagField(raw.complaint_text ?? [], false);
  tagged.survey_scores = tagField(raw.survey_scores ?? [], false);
  tagged.app_last_login_date = tagField(raw.app_last_login_date ?? null, false);
  tagged.unified_id_present = tagField(
    raw.unified_id_present !== undefined ? raw.unified_id_present : false,
    raw.unified_id_present === undefined,
    "Defaulted to false when absent — matches Asteron's own base rate of 38% unified-ID coverage, so absence is a statistically grounded assumption rather than an arbitrary one."
  );

  // Inferred: expected service interval, from vehicle category.
  if (raw.service_interval_expected_months !== undefined && raw.service_interval_expected_months !== null) {
    tagged.service_interval_expected_months = tagField(raw.service_interval_expected_months, false);
  } else {
    const inferred = SERVICE_INTERVAL_MONTHS_BY_CATEGORY[raw.vehicle_category] ?? 6;
    tagged.service_interval_expected_months = tagField(
      inferred,
      true,
      `Inferred from vehicle_category ("${raw.vehicle_category}") using Asteron's typical service-interval schedule.`
    );
  }

  // Derived (not really "inferred" — a direct calculation from an observed field).
  if (raw.purchase_date) {
    tagged.vehicle_age_months = tagField(monthsBetween(raw.purchase_date, today), false);
  } else {
    tagged.vehicle_age_months = tagField(null, false);
  }

  // The genuinely ambiguous field: was the first service booked at delivery?
  // No other field in the record reliably predicts this — it is not
  // inferred, only observed-or-missing.
  tagged.first_service_booked_at_delivery = tagField(
    raw.first_service_booked_at_delivery ?? null,
    false
  );

  tagged.authorized_discount_range = tagField(raw.authorized_discount_range ?? null, false);

  // --- Decision-critical ambiguity checks -----------------------------
  // Only ask the dealer when a specific missing field would actually
  // change which diagnosis category applies. Never ask a generic
  // "please review this case" question.

  const neverVisited = tagged.service_visit_count.value === 0;
  const deliveryBookingUnknown = tagged.first_service_booked_at_delivery.status === "missing";

  if (neverVisited && deliveryBookingUnknown) {
    return {
      record: tagged,
      needsHumanInput: true,
      humanQuestion: `Was a first service appointment booked for ${raw.customer_id} at the time of delivery? (Yes / No / Unsure)`,
      skipLLM: true
    };
  }

  const hasVisits = tagged.service_visit_count.value >= 1;
  const noSentimentSignal =
    (tagged.complaint_text.value?.length ?? 0) === 0 &&
    (tagged.survey_scores.value?.length ?? 0) === 0;

  if (hasVisits && noSentimentSignal) {
    return {
      record: tagged,
      needsHumanInput: true,
      humanQuestion: `Did ${raw.customer_id} raise any concerns during their visits? (Cost / Wait time / Quality / None noted)`,
      skipLLM: true
    };
  }

  // No blocking ambiguity — proceed to the LLM diagnosis call.
  return {
    record: tagged,
    needsHumanInput: false,
    humanQuestion: null,
    skipLLM: false
  };
}
