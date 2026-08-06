/**
 * lead_completeness_check.js
 *
 * Same design pattern as completeness_check.js (retention agent): plain,
 * deterministic code runs before any LLM call. Inference from correlated
 * fields belongs here, auditable and consistent — not left to the model.
 *
 * The one thing genuinely worth asking a human about, before ever
 * calling an LLM: a lead with no phone AND no email simply can't be
 * contacted, no amount of AI judgment changes that. Everything else
 * proceeds straight to triage.
 *
 * Exports: checkLeadCompleteness(rawLead) -> {
 *   record, needsHumanInput, humanQuestion, skipLLM
 * }
 */

const HARD_REQUIRED_FIELDS = ["lead_id", "vehicle_category"];

// Expected first-response SLA, inferred from the same two signals the
// case data ties to share loss: city tier (loss concentrated in the top
// 20 cities) and vehicle segment (loss concentrated in SUVs). This is a
// documented assumption, not an invented one — grounded in Section 1b's
// own language, not a fabricated benchmark.
function inferExpectedSlaHours(cityTier, vehicleCategory) {
  if (cityTier === "tier1" && vehicleCategory === "suv") return 4;
  if (cityTier === "tier1") return 8;
  return 24; // matches the case's own "32% not contacted within 24 hours" framing
}

function tagField(value, isInferred, basis) {
  return {
    value,
    status: value === null || value === undefined ? "missing" : (isInferred ? "inferred" : "observed"),
    basis: isInferred ? basis : undefined
  };
}

function hoursBetween(dateA, dateB) {
  return (new Date(dateB) - new Date(dateA)) / (1000 * 60 * 60);
}

export function checkLeadCompleteness(raw) {
  const missingHard = HARD_REQUIRED_FIELDS.filter((f) => raw[f] === undefined || raw[f] === null);
  if (missingHard.length > 0) {
    return {
      record: null,
      needsHumanInput: true,
      humanQuestion: `Lead ${raw.lead_id || "record"} is missing required field(s): ${missingHard.join(", ")}. Please supply before this lead can be triaged.`,
      skipLLM: true
    };
  }

  const now = raw.as_of_datetime || new Date().toISOString();
  const tagged = {};

  tagged.lead_id = tagField(raw.lead_id, false);
  tagged.vehicle_category = tagField(raw.vehicle_category, false);
  tagged.source = tagField(raw.source ?? null, false);
  tagged.qualified_at = tagField(raw.qualified_at, false);
  tagged.city_tier = tagField(raw.city_tier ?? "tier2", raw.city_tier === undefined, "Defaulted to tier2 (mid-size city) when unspecified — a neutral middle assumption rather than assuming the highest-priority tier.");
  tagged.contact_phone_available = tagField(raw.contact_phone_available ?? false, false);
  tagged.contact_email_available = tagField(raw.contact_email_available ?? false, false);
  tagged.contact_attempts = tagField(raw.contact_attempts ?? 0, false);
  tagged.last_contact_attempt_at = tagField(raw.last_contact_attempt_at ?? null, false);
  tagged.customer_type = tagField(raw.customer_type ?? "new", raw.customer_type === undefined, "Defaulted to 'new' when unspecified — the conservative assumption (repeat/referral status should be a positive signal that's explicitly on record, not inferred).");
  tagged.test_drive_requested = tagField(raw.test_drive_requested ?? false, false);
  tagged.notes = tagField(raw.notes ?? [], false);

  tagged.hours_since_qualified = raw.qualified_at
    ? tagField(Math.round(hoursBetween(raw.qualified_at, now) * 10) / 10, false)
    : tagField(null, false);

  if (raw.expected_sla_hours !== undefined && raw.expected_sla_hours !== null) {
    tagged.expected_sla_hours = tagField(raw.expected_sla_hours, false);
  } else {
    const inferred = inferExpectedSlaHours(tagged.city_tier.value, raw.vehicle_category);
    tagged.expected_sla_hours = tagField(
      inferred, true,
      `Inferred from city_tier ("${tagged.city_tier.value}") and vehicle_category ("${raw.vehicle_category}") — tier-1 cities and SUVs are where the case data shows share loss is concentrated, so they get the tightest expected response windows.`
    );
  }

  // The one decision-critical ambiguity: no way to reach this lead at all.
  const noContactMethod = !tagged.contact_phone_available.value && !tagged.contact_email_available.value;
  if (noContactMethod) {
    return {
      record: tagged,
      needsHumanInput: true,
      humanQuestion: `No phone or email on file for ${raw.lead_id}. Do you have a way to reach this lead? (Phone / Email / Lead is unreachable)`,
      skipLLM: true
    };
  }

  return { record: tagged, needsHumanInput: false, humanQuestion: null, skipLLM: false };
}
