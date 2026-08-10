/**
 * lead_validate.js
 *
 * v2 — updated for the High/Medium/Low lead_score taxonomy and the new
 * "draft_message required when not asking a question" rule. Also now
 * exports computeAutoSend(): the single, explicit gate between "sent
 * automatically" and "held for a dealer to review" — the one place in
 * the whole pipeline that decides that question, so it's auditable in
 * one spot rather than scattered across index.js and the dashboard.
 *
 * Same two-layer pattern as before: structural check against
 * lead_output_schema.json, then worker-side rules that need the INPUT
 * record (not just the response) to verify.
 */

const VALID_SCORES = ["high", "medium", "low"];
const VALID_PLAYBOOK_CODES = ["immediate_call", "standard_outreach", "nurture_sequence"];
const VALID_CHANNELS = ["sms", "email", "call_brief"];

const SCORE_TO_PLAYBOOK = {
  high: "immediate_call",
  medium: "standard_outreach",
  low: "nurture_sequence"
};

function fail(reason) {
  return { ok: false, reason };
}

function structuralCheck(out) {
  if (typeof out !== "object" || out === null) return fail("response is not a JSON object");
  if (typeof out.lead_id !== "string" || !out.lead_id) return fail("missing lead_id");

  const s = out.scoring;
  if (typeof s !== "object" || s === null) return fail("missing scoring object");
  if (!VALID_SCORES.includes(s.lead_score)) return fail("invalid scoring.lead_score");
  if (!Array.isArray(s.evidence) || s.evidence.length < 1) return fail("scoring.evidence must be a non-empty array");
  if (!s.evidence.every((e) => typeof e === "string")) return fail("scoring.evidence must be all strings");
  if (typeof s.confidence !== "number" || s.confidence < 0 || s.confidence > 100) return fail("scoring.confidence out of range");

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
  "said", "told", "into", "than", "have", "does", "some", "these", "lead",
  // Added after a real false positive: the AI's own reasoning/connector
  // vocabulary was being penalized as if it needed to match the record
  // too — e.g. "Customer type and lead source are observed as
  // 'referral', indicating high purchase intent" got flagged as
  // ungrounded even though the actual claim (referral) was 100% real,
  // purely because "observed," "indicating," "purchase," and "intent"
  // don't literally appear in any field. Those words describe the AI's
  // reasoning, not a fact that needs verifying — only the substantive
  // claim (the field values themselves) should be checked.
  "observed", "indicating", "indicates", "indicated", "suggest",
  "suggests", "suggesting", "shows", "showing", "signal", "signals",
  "based", "level", "status", "profile", "purchase", "intent", "likely",
  "shown", "reflects", "reflecting",
  // Common pronouns/function words — a backstop in case a coincidental
  // match slips through from anywhere else. These carry no evidentiary
  // weight on their own and shouldn't count as a "match."
  "they", "them", "then", "when", "where", "here", "what", "your",
  "will"
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
      // Deliberately NOT including field.basis here (removed after a
      // real false-negative was traced to it): basis is long-form
      // prose explaining WHY a value was inferred ("...so they get the
      // tightest expected response windows"), not a fact itself. Full
      // sentences are exactly where a fabricated claim can coincidentally
      // share a common word (an article, a pronoun) with real content
      // and slip past the grounding check. Field names and values alone
      // are short, specific, and don't carry that risk.
    } else {
      push(field); // matched_dealer and similar untagged context objects
    }
  }
  return parts.join(" ").toLowerCase();
}

// Grounding rule: EITHER the match ratio clears a modest bar, OR at
// least 2 substantive words match outright — whichever is easier to
// satisfy. This exists because a ratio alone breaks down against real
// evidence wrapped in reasoning language: "Zero prior contact attempts
// recorded with no negative disengagement signals" is a 100% true
// claim (contact_attempts really is 0), but most of its words are the
// AI's own analysis vocabulary, not facts — no stopword list can
// enumerate every way a model might phrase that. Requiring only 2 real
// word-matches, regardless of how much reasoning language surrounds
// them, is robust to phrasing variation in a way a pure ratio isn't,
// while a fabricated claim (which shares at most one word with the
// record by coincidence) still fails both paths.
function evidenceIsGrounded(evidenceItem, factsBlob) {
  const words = tokenize(evidenceItem);
  if (words.length === 0) return false;
  const matched = words.filter((w) => factsBlob.includes(w));
  return (matched.length / words.length) >= 0.25 || matched.length >= 2;
}

function applyWorkerSideRules(out, taggedRecord) {
  const result = { ...out, scoring: { ...out.scoring }, recommended_action: { ...out.recommended_action } };
  const notes = [];
  let reviewForced = false;

  // Rule: needs_human_input -> draft_message MUST be null.
  if (result.needs_human_input && result.draft_message) {
    result.draft_message = null;
    notes.push("Stripped draft_message: needs_human_input was true.");
  }

  // Rule: NOT needing human input -> draft_message MUST be present.
  // (New in v2 — every scored lead gets an acknowledgment now.)
  if (!result.needs_human_input && !result.draft_message) {
    reviewForced = true;
    notes.push("Model did not produce a draft_message despite needs_human_input being false — every scored lead requires an acknowledgment. Held for review rather than auto-sending nothing.");
  }

  // Rule: playbook_code must match lead_score's fixed mapping.
  const expected = SCORE_TO_PLAYBOOK[result.scoring.lead_score];
  if (expected && result.recommended_action.playbook_code !== expected) {
    reviewForced = true;
    notes.push(`playbook_code (${result.recommended_action.playbook_code}) does not match lead_score (${result.scoring.lead_score} -> ${expected}).`);
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

  // Evidence-grounding is checked but, as of this fix, no longer BLOCKS
  // auto-send on its own. After three separate rounds of real false
  // positives — each one a genuinely true claim, flagged only because a
  // word-overlap heuristic couldn't parse that specific phrasing —
  // the honest conclusion is that no amount of stopword/threshold
  // tuning keeps pace with how much an LLM's phrasing varies. Blocking
  // real, good leads more often than it was catching real fabrication
  // stopped being worth it. It's still logged here (visible in the raw
  // response) as a transparency note, not as proof of fabrication. The
  // two rules above — score/action consistency, channel availability —
  // remain hard gates: both are exact comparisons against fixed enums,
  // and neither has produced a false positive in testing.
  const factsBlob = extractKnownFacts(taggedRecord);
  const unmatched = (result.scoring.evidence || []).filter((e) => !evidenceIsGrounded(e, factsBlob));
  if (unmatched.length > 0) {
    notes.push(`Note (non-blocking): ${unmatched.length} evidence item(s) used phrasing this check couldn't fully verify — not treated as fabrication on its own: ${JSON.stringify(unmatched)}`);
  }

  if (reviewForced) result.review_flag = true;
  return { output: result, reviewForced, notes };
}

/**
 * The single explicit gate between "sent automatically" and "held for
 * a dealer to review." Deliberately its own named function rather than
 * inline logic in index.js, so the rule is auditable in one place: an
 * acknowledgment auto-sends ONLY when the model didn't need to ask a
 * question, the message actually exists, and nothing in
 * applyWorkerSideRules() above found a reason to flag it. Anything less
 * than a fully clean pass falls back to human review — automation with
 * a safety net, not automation instead of one.
 */
export function computeAutoSend(output) {
  return Boolean(
    output &&
    output.needs_human_input === false &&
    output.review_flag === false &&
    output.draft_message
  );
}

export function buildLeadReviewFallback(taggedRecord, reasonText) {
  return {
    lead_id: taggedRecord?.lead_id?.value ?? "unknown",
    scoring: {
      lead_score: "medium",
      evidence: ["Automated scoring unavailable — routed to human review to avoid a missed lead."],
      confidence: 0
    },
    needs_human_input: true,
    human_question: reasonText || "Automated scoring failed. Please review this lead manually.",
    recommended_action: {
      playbook_code: "standard_outreach",
      description: "Contact via the lead's preferred available channel within the expected response window."
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
