/**
 * lead_validate.js
 *
 * Same two-layer pattern as validate.js: structural check against
 * lead_output_schema.json, then the worker-side rules that need the
 * INPUT record (not just the response) to verify — a generic schema
 * validator can't see whether a channel is actually reachable, or
 * whether evidence is grounded in the record.
 */

const VALID_TIERS = ["critical", "high", "standard", "nurture"];
const VALID_PLAYBOOK_CODES = ["immediate_call", "priority_outreach", "standard_outreach", "nurture_sequence"];
const VALID_CHANNELS = ["sms", "email", "call_brief"];

const TIER_TO_PLAYBOOK = {
  critical: "immediate_call",
  high: "priority_outreach",
  standard: "standard_outreach",
  nurture: "nurture_sequence"
};

function fail(reason) {
  return { ok: false, reason };
}

function structuralCheck(out) {
  if (typeof out !== "object" || out === null) return fail("response is not a JSON object");
  if (typeof out.lead_id !== "string" || !out.lead_id) return fail("missing lead_id");

  const t = out.triage;
  if (typeof t !== "object" || t === null) return fail("missing triage object");
  if (!VALID_TIERS.includes(t.priority_tier)) return fail("invalid triage.priority_tier");
  if (!Array.isArray(t.evidence) || t.evidence.length < 1) return fail("triage.evidence must be a non-empty array");
  if (!t.evidence.every((e) => typeof e === "string")) return fail("triage.evidence must be all strings");
  if (typeof t.confidence !== "number" || t.confidence < 0 || t.confidence > 100) return fail("triage.confidence out of range");

  if (typeof out.needs_human_input !== "boolean") return fail("missing needs_human_input");
  if (out.human_question !== undefined && out.human_question !== null && typeof out.human_question !== "string") {
    return fail("human_question must be string or null");
  }

  const ra = out.recommended_action;
  if (typeof ra !== "object" || ra === null) return fail("missing recommended_action");
  if (!VALID_PLAYBOOK_CODES.includes(ra.playbook_code)) return fail("invalid recommended_action.playbook_code");
  if (typeof ra.description !== "string" || !ra.description) return fail("missing recommended_action.description");

  if (out.draft_message !== undefined && out.draft_message !== null) {
    const dm = out.draft_message;
    if (typeof dm !== "object") return fail("draft_message must be an object or null");
    if (!VALID_CHANNELS.includes(dm.channel)) return fail("invalid draft_message.channel");
    if (typeof dm.text !== "string" || !dm.text) return fail("missing draft_message.text");
  }

  if (typeof out.review_flag !== "boolean") return fail("missing review_flag");
  return { ok: true };
}

const STOPWORDS = new Set([
  "this", "that", "with", "from", "were", "being", "which", "there",
  "their", "about", "would", "could", "should", "after", "before",
  "while", "during", "customer", "record", "records", "field", "value",
  "said", "told", "into", "than", "have", "does", "some", "these", "lead"
]);

function tokenize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

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

function evidenceIsGrounded(evidenceItem, factsBlob) {
  const words = tokenize(evidenceItem);
  if (words.length === 0) return false;
  const matched = words.filter((w) => factsBlob.includes(w));
  return matched.length / words.length >= 0.5;
}

function applyWorkerSideRules(out, taggedRecord) {
  const result = { ...out, triage: { ...out.triage }, recommended_action: { ...out.recommended_action } };
  const notes = [];
  let reviewForced = false;

  // Rule: needs_human_input -> draft_message MUST be null.
  if (result.needs_human_input && result.draft_message) {
    result.draft_message = null;
    notes.push("Stripped draft_message: needs_human_input was true.");
  }

  // Rule: playbook_code must match priority_tier's fixed mapping.
  const expected = TIER_TO_PLAYBOOK[result.triage.priority_tier];
  if (expected && result.recommended_action.playbook_code !== expected) {
    reviewForced = true;
    notes.push(`playbook_code (${result.recommended_action.playbook_code}) does not match priority_tier (${result.triage.priority_tier} -> ${expected}).`);
  }

  // Extra guardrail: draft_message.channel must actually be reachable.
  if (result.draft_message) {
    const channel = result.draft_message.channel;
    const phoneOk = taggedRecord?.contact_phone_available?.value === true;
    const emailOk = taggedRecord?.contact_email_available?.value === true;
    const channelReachable = (channel === "sms" || channel === "call_brief") ? phoneOk : channel === "email" ? emailOk : false;
    if (!channelReachable) {
      reviewForced = true;
      notes.push(`draft_message.channel ("${channel}") is not available for this lead per contact_phone_available/contact_email_available.`);
    }
  }

  // Rule: every evidence citation must be traceable to the record.
  const factsBlob = extractKnownFacts(taggedRecord);
  const unmatched = (result.triage.evidence || []).filter((e) => !evidenceIsGrounded(e, factsBlob));
  if (unmatched.length > 0) {
    reviewForced = true;
    notes.push(`${unmatched.length} evidence item(s) could not be matched to the record: ${JSON.stringify(unmatched)}`);
  }

  if (reviewForced) result.review_flag = true;
  return { output: result, reviewForced, notes };
}

export function buildLeadReviewFallback(taggedRecord, reasonText) {
  return {
    lead_id: taggedRecord?.lead_id?.value ?? "unknown",
    triage: {
      priority_tier: "high",
      evidence: ["Automated triage unavailable — routed to human review to avoid a missed lead."],
      confidence: 0
    },
    needs_human_input: true,
    human_question: reasonText || "Automated triage failed. Please review this lead manually.",
    recommended_action: {
      playbook_code: "priority_outreach",
      description: "Contact via phone and SMS today, ahead of standard-priority leads."
    },
    draft_message: null,
    review_flag: true
  };
}

export function validateLeadAndEnforce(rawParsed, taggedRecord) {
  const structural = structuralCheck(rawParsed);
  if (!structural.ok) {
    return {
      ok: false,
      reason: structural.reason,
      fallback: buildLeadReviewFallback(taggedRecord, `Model output failed structural validation: ${structural.reason}`)
    };
  }
  const { output, notes } = applyWorkerSideRules(rawParsed, taggedRecord);
  return { ok: true, output, notes };
}
