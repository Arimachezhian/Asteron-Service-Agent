/**
 * validate.js
 *
 * Two layers of defense on every model response, matching the two
 * things README.md says the Worker is responsible for:
 *
 *   1. structuralCheck() — is this even a well-formed
 *      RetentionAgentDiagnosisOutput per output_schema.json?
 *   2. applyWorkerSideRules() — the four rules output_schema.json lists
 *      under x_worker_side_validation_rules, which need values from the
 *      INPUT record (e.g. authorized_discount_range) that a generic JSON
 *      Schema validator has no way to see. Hand-rolled rather than a
 *      library: the schema is small and fixed, and hand-rolling keeps
 *      the Worker dependency-free (matters for Cloudflare's free-tier
 *      bundle size) and keeps every failure reason legible in logs.
 *
 * Nothing here ever throws on a malformed model response — a failure
 * downgrades to review_flag = true / buildReviewFallback(), never a
 * crash, per the design principle in README.md: "the agent asks, it
 * doesn't guess, when it can't tell."
 */

const VALID_CATEGORIES = ["A", "B", "C", "D", "E", "F"];
const VALID_PLAYBOOK_CODES = [
  "schedule_warm_call",
  "transparent_quote",
  "priority_slot",
  "escalate_human_only",
  "soft_reminder",
  "value_package"
];
const VALID_CHANNELS = ["sms", "email", "call_brief", "app_notification"];

const CATEGORY_TO_PLAYBOOK = {
  A: "schedule_warm_call",
  B: "transparent_quote",
  C: "priority_slot",
  D: "escalate_human_only",
  E: "soft_reminder",
  F: "value_package"
};

function fail(reason) {
  return { ok: false, reason };
}

function structuralCheck(out) {
  if (typeof out !== "object" || out === null) return fail("response is not a JSON object");
  if (typeof out.customer_id !== "string" || !out.customer_id) return fail("missing customer_id");

  const d = out.diagnosis;
  if (typeof d !== "object" || d === null) return fail("missing diagnosis object");
  if (!VALID_CATEGORIES.includes(d.primary_category)) return fail("invalid diagnosis.primary_category");
  if (
    d.secondary_category !== undefined &&
    d.secondary_category !== null &&
    !VALID_CATEGORIES.includes(d.secondary_category)
  ) {
    return fail("invalid diagnosis.secondary_category");
  }
  if (!Array.isArray(d.evidence) || d.evidence.length < 1) return fail("diagnosis.evidence must be a non-empty array");
  if (!d.evidence.every((e) => typeof e === "string")) return fail("diagnosis.evidence must be all strings");
  if (typeof d.confidence !== "number" || d.confidence < 0 || d.confidence > 100) {
    return fail("diagnosis.confidence out of range");
  }

  if (typeof out.needs_human_input !== "boolean") return fail("missing needs_human_input");
  if (out.human_question !== undefined && out.human_question !== null && typeof out.human_question !== "string") {
    return fail("human_question must be string or null");
  }

  const ra = out.recommended_action;
  if (typeof ra !== "object" || ra === null) return fail("missing recommended_action");
  if (!VALID_PLAYBOOK_CODES.includes(ra.playbook_code)) return fail("invalid recommended_action.playbook_code");
  if (typeof ra.description !== "string" || !ra.description) return fail("missing recommended_action.description");
  if (typeof ra.requires_human_review_only !== "boolean") {
    return fail("missing recommended_action.requires_human_review_only");
  }

  if (out.draft_message !== undefined && out.draft_message !== null) {
    const dm = out.draft_message;
    if (typeof dm !== "object") return fail("draft_message must be an object or null");
    if (!VALID_CHANNELS.includes(dm.channel)) return fail("invalid draft_message.channel");
    if (typeof dm.text !== "string" || !dm.text) return fail("missing draft_message.text");
    if (
      dm.discount_offered !== undefined &&
      dm.discount_offered !== null &&
      typeof dm.discount_offered !== "number"
    ) {
      return fail("draft_message.discount_offered must be number or null");
    }
  }

  if (typeof out.review_flag !== "boolean") return fail("missing review_flag");

  return { ok: true };
}

// Words too generic or too common across almost every record/field name
// to carry grounding signal on their own (e.g. "customer" appears in
// half the field names, so its presence in evidence proves nothing).
// Kept small and conservative — this is a recall aid, not a precision
// mechanism; false negatives (flagging real evidence) are more costly
// here than false positives (missing a fabrication), since every flag
// is only a "send to human review," never a silent block.
const STOPWORDS = new Set([
  "this", "that", "with", "from", "were", "being", "which", "there",
  "their", "about", "would", "could", "should", "after", "before",
  "while", "during", "customer", "record", "records", "field", "value",
  "said", "told", "into", "than", "have", "does", "some", "these"
]);

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

/**
 * Builds a single lowercase "known facts" blob from the tagged record so
 * evidence citations can be spot-checked against it. Word-overlap, not
 * exact-substring or verbatim-quote matching — the model is expected to
 * paraphrase (e.g. "customer said the bill was higher than the quote"
 * for a complaint that reads "final bill was much higher than the
 * quote"), so this is a heuristic to catch fabrication, not a formal
 * provenance proof.
 */
function extractKnownFacts(taggedRecord) {
  const parts = [];
  const push = (v) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) return v.forEach(push);
    if (typeof v === "object") return Object.values(v).forEach(push);
    parts.push(String(v));
  };

  for (const [fieldName, field] of Object.entries(taggedRecord || {})) {
    parts.push(fieldName.replace(/_/g, " "));
    if (field && typeof field === "object" && "value" in field) {
      push(field.value);
      if (field.basis) push(field.basis);
    }
  }
  return parts.join(" ").toLowerCase();
}

/**
 * An evidence item is "grounded" if at least half of its significant
 * (non-stopword, length >= 4) words appear somewhere in the record's
 * facts blob. Evidence with no significant words at all (e.g. very
 * short strings) is treated as ungrounded-by-default rather than
 * vacuously true, so an empty or near-empty citation still gets flagged.
 */
function evidenceIsGrounded(evidenceItem, factsBlob) {
  const words = tokenize(evidenceItem);
  if (words.length === 0) return false;
  const matched = words.filter((w) => factsBlob.includes(w));
  return matched.length / words.length >= 0.5;
}

/**
 * Applies the four x_worker_side_validation_rules from output_schema.json,
 * plus one extra belt-and-suspenders check (category D always forces
 * requires_human_review_only = true) mirroring the guardrail README.md
 * says is "enforced twice: once in the prompt instructions, once again
 * in the schema validation rules." Mutates a shallow copy, never the
 * original response object.
 */
function applyWorkerSideRules(out, taggedRecord) {
  const result = {
    ...out,
    diagnosis: { ...out.diagnosis },
    recommended_action: { ...out.recommended_action }
  };
  const notes = [];
  let reviewForced = false;

  // Rule 1 (schema): escalate_human_only -> draft_message MUST be null.
  if (result.recommended_action.playbook_code === "escalate_human_only" && result.draft_message) {
    result.draft_message = null;
    notes.push("Stripped draft_message: escalate_human_only must never carry a customer-facing message.");
  }

  // Rule 2 (schema): needs_human_input == true -> draft_message MUST be null.
  if (result.needs_human_input && result.draft_message) {
    result.draft_message = null;
    notes.push("Stripped draft_message: needs_human_input was true.");
  }

  // Extra guardrail (from system_prompt.md, not the 4 numbered rules):
  // category D always requires human review.
  if (result.diagnosis.primary_category === "D" && !result.recommended_action.requires_human_review_only) {
    result.recommended_action.requires_human_review_only = true;
    notes.push("Forced requires_human_review_only=true for category D.");
  }

  // Sanity: playbook_code must match primary_category's fixed mapping.
  const expectedPlaybook = CATEGORY_TO_PLAYBOOK[result.diagnosis.primary_category];
  if (expectedPlaybook && result.recommended_action.playbook_code !== expectedPlaybook) {
    reviewForced = true;
    notes.push(
      `playbook_code (${result.recommended_action.playbook_code}) does not match primary_category ` +
        `(${result.diagnosis.primary_category} -> ${expectedPlaybook}).`
    );
  }

  // Rule 3 (schema): discount_offered must fall within authorized_discount_range.
  if (result.draft_message && result.draft_message.discount_offered !== undefined && result.draft_message.discount_offered !== null) {
    const range = taggedRecord?.authorized_discount_range?.value ?? null;
    const discount = result.draft_message.discount_offered;
    if (!Array.isArray(range) || range.length !== 2 || discount < range[0] || discount > range[1]) {
      reviewForced = true;
      notes.push(`discount_offered (${discount}) is outside authorized_discount_range (${JSON.stringify(range)}).`);
    }
  }

  // Rule 4 (schema): every evidence citation must be traceable to the record.
  const factsBlob = extractKnownFacts(taggedRecord);
  const unmatched = (result.diagnosis.evidence || []).filter((e) => !evidenceIsGrounded(e, factsBlob));
  if (unmatched.length > 0) {
    reviewForced = true;
    notes.push(`${unmatched.length} evidence item(s) could not be matched to the record: ${JSON.stringify(unmatched)}`);
  }

  if (reviewForced) {
    result.review_flag = true;
  }

  return { output: result, reviewForced, notes };
}

/**
 * Used when the model output can't be trusted at all (bad JSON, failed
 * structural validation, or both providers erroring out). Never silently
 * drops the customer — always routes to a human with review_flag true.
 */
export function buildReviewFallback(taggedRecord, reasonText) {
  return {
    customer_id: taggedRecord?.customer_id?.value ?? "unknown",
    diagnosis: {
      primary_category: "D",
      secondary_category: null,
      evidence: ["Automated diagnosis unavailable — routed to human review."],
      confidence: 0
    },
    needs_human_input: true,
    human_question: reasonText || "Automated diagnosis failed. Please review this customer manually.",
    recommended_action: {
      playbook_code: "escalate_human_only",
      description: "Escalate to the service manager for direct human review.",
      requires_human_review_only: true
    },
    draft_message: null,
    review_flag: true
  };
}

export function validateAndEnforce(rawParsed, taggedRecord) {
  const structural = structuralCheck(rawParsed);
  if (!structural.ok) {
    return {
      ok: false,
      reason: structural.reason,
      fallback: buildReviewFallback(taggedRecord, `Model output failed structural validation: ${structural.reason}`)
    };
  }
  const { output, notes } = applyWorkerSideRules(rawParsed, taggedRecord);
  return { ok: true, output, notes };
}
