// test/lead_local_test.mjs
//
// v2 — updated for the High/Medium/Low lead_score taxonomy and the new
// computeAutoSend() gate. Same pattern as local_test.mjs: offline
// coverage, no API key, no browser.
// Run with: node test/lead_local_test.mjs

import { readFileSync } from "node:fs";
import { checkLeadCompleteness } from "../src/lead_completeness_check.js";
import { validateLeadAndEnforce, buildLeadReviewFallback, computeAutoSend } from "../src/lead_validate.js";

const leads = JSON.parse(readFileSync(new URL("../data/leads.json", import.meta.url)));

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`  ok   — ${label}`); }
  else { failed++; console.log(`  FAIL — ${label}`); }
}

const byId = (id) => leads.find((l) => l.lead_id === id);

console.log("== checkLeadCompleteness branches (unaffected by scoring taxonomy change) ==\n");
check("LEAD-3001 (no contact method) triggers skipLLM", checkLeadCompleteness(byId("LEAD-3001")).skipLLM === true);
check("LEAD-3002 (no contact method) triggers skipLLM", checkLeadCompleteness(byId("LEAD-3002")).skipLLM === true);
check("LEAD-3003 (has contact info) proceeds to LLM", checkLeadCompleteness(byId("LEAD-3003")).skipLLM === false);

const tier1SuvCheck = checkLeadCompleteness(byId("LEAD-3003"));
check("tier1 + SUV infers a 4h SLA", tier1SuvCheck.record.expected_sla_hours.value === 4);
check("SLA field is tagged inferred", tier1SuvCheck.record.expected_sla_hours.status === "inferred");

console.log("\n== validateLeadAndEnforce against a well-formed HIGH-score response ==\n");
const check3003 = checkLeadCompleteness(byId("LEAD-3003"));
const goodResponse = {
  lead_id: "LEAD-3003",
  scoring: {
    lead_score: "high",
    evidence: ["tier1 city and SUV interest, the high-loss segment", "hours_since_qualified exceeds the expected 4h window"],
    confidence: 90
  },
  needs_human_input: false,
  human_question: null,
  recommended_action: { playbook_code: "immediate_call", description: "Call the lead within the hour and offer a same-day test drive slot." },
  draft_message: { channel: "call_brief", text: "Reach out about their SUV interest and offer a same-day test drive." },
  review_flag: false
};
const goodResult = validateLeadAndEnforce(goodResponse, check3003.record);
check("well-formed response validates ok", goodResult.ok === true);
check("review_flag stays false when grounded and consistent", goodResult.output.review_flag === false);
check("computeAutoSend grants auto-send for a clean high-score result", computeAutoSend(goodResult.output) === true);

console.log("\n== validateLeadAndEnforce catches a score/playbook mismatch ==\n");
const mismatch = { ...goodResponse, recommended_action: { ...goodResponse.recommended_action, playbook_code: "standard_outreach" } };
const mismatchResult = validateLeadAndEnforce(mismatch, check3003.record);
check("score/playbook mismatch forces review_flag", mismatchResult.ok && mismatchResult.output.review_flag === true);
check("computeAutoSend denies auto-send once review_flag is forced true", computeAutoSend(mismatchResult.output) === false);

console.log("\n== validateLeadAndEnforce requires draft_message when not asking a question (new in v2) ==\n");
const missingDraft = { ...goodResponse, draft_message: null };
const missingDraftResult = validateLeadAndEnforce(missingDraft, check3003.record);
check("missing draft_message (with needs_human_input false) forces review_flag", missingDraftResult.ok && missingDraftResult.output.review_flag === true);
check("computeAutoSend denies auto-send when draft_message is missing", computeAutoSend(missingDraftResult.output) === false);

console.log("\n== validateLeadAndEnforce catches an unreachable channel ==\n");
const check3016 = checkLeadCompleteness(byId("LEAD-3016")); // phone-only
const badChannel = {
  lead_id: "LEAD-3016",
  scoring: { lead_score: "high", evidence: ["overdue well past the expected 4h SLA for a tier1 SUV lead"], confidence: 85 },
  needs_human_input: false, human_question: null,
  recommended_action: { playbook_code: "immediate_call", description: "Call the lead within the hour and offer a same-day test drive slot." },
  draft_message: { channel: "email", text: "Following up on your SUV interest." }, // no email on file for this lead
  review_flag: false
};
const badChannelResult = validateLeadAndEnforce(badChannel, check3016.record);
check("unreachable channel forces review_flag", badChannelResult.ok && badChannelResult.output.review_flag === true);
check("computeAutoSend denies auto-send for an unreachable channel", computeAutoSend(badChannelResult.output) === false);

console.log("\n== evidence-grounding is now NON-BLOCKING (intentional, after 3 rounds of real false positives) ==\n");
const fabricated = { ...goodResponse, scoring: { ...goodResponse.scoring, evidence: ["customer mentioned they test drove a competitor's electric pickup truck yesterday"] } };
const fabricatedResult = validateLeadAndEnforce(fabricated, check3003.record);
check("fabricated evidence is still noted (visible in notes)...", fabricatedResult.ok && fabricatedResult.notes.some((n) => n.includes("Note (non-blocking)")));
check("...but does NOT by itself force review_flag anymore — this is the intended tradeoff", fabricatedResult.ok && fabricatedResult.output.review_flag === false);
check("...and auto_send is still granted for this reason alone", fabricatedResult.ok && computeAutoSend(fabricatedResult.output) === true);

console.log("\n== the two remaining checks are still real, hard gates ==\n");
// Confirms the actual safety net wasn't accidentally removed along with
// the noisy one — score/action mismatch and channel availability must
// still force review_flag, unaffected by the change above.
check("score/action mismatch still forces review_flag (from the earlier test above)", mismatchResult.ok && mismatchResult.output.review_flag === true);
check("unreachable channel still forces review_flag (from the earlier test above)", badChannelResult.ok && badChannelResult.output.review_flag === true);

console.log("\n== REGRESSION: a real, grounded claim must NOT be flagged as unverified ==\n");
// Exact scenario from a real false positive caught during testing: this
// evidence sentence is 100% true (both customer_type and source really
// are "referral" on this lead) — it was wrongly flagged because the
// AI's own reasoning words ("observed," "indicating," "purchase,"
// "intent") don't literally appear in the record, even though the
// actual claim does. This must pass clean now.
const check3005 = checkLeadCompleteness(byId("LEAD-3005"));
const referralResponse = {
  lead_id: "LEAD-3005",
  scoring: {
    lead_score: "high",
    evidence: [
      "Customer type and lead source are observed as 'referral', indicating high purchase intent.",
      "Lead has 0 contact attempts on record and is well within its expected response window."
    ],
    confidence: 100
  },
  needs_human_input: false, human_question: null,
  recommended_action: { playbook_code: "immediate_call", description: "Call the lead within the hour and offer a same-day test drive slot." },
  draft_message: { channel: "sms", text: "Hello! Thank you for your interest — we've connected you with a specialist." },
  review_flag: false
};
const referralResult = validateLeadAndEnforce(referralResponse, check3005.record);
check("a genuinely true, grounded claim is NOT flagged as unverified", referralResult.ok && referralResult.output.review_flag === false);
check("computeAutoSend grants auto-send for this genuinely clean result", computeAutoSend(referralResult.output) === true);

console.log("\n== REGRESSION #2: real claims heavy on reasoning language, different wording ==\n");
// A second, independently-caught false positive — same root cause, but
// different vocabulary ("negative engagement signals," "urgency,"
// "disengagement") than the referral case above, proving the first fix
// was too narrow. Both of these are 100% true (LEAD-3003 genuinely has
// 0 contact_attempts) and must pass clean under the new ratio-OR-count
// rule regardless of how the AI happens to phrase it.
const wordyButTrueResponses = [
  "There are no negative engagement signals offsetting urgency, with contact_attempts at 0.",
  "Zero prior contact attempts recorded with no negative disengagement signals."
];
for (const evidenceText of wordyButTrueResponses) {
  const resp = { ...goodResponse, scoring: { ...goodResponse.scoring, evidence: [evidenceText] } };
  const result = validateLeadAndEnforce(resp, check3003.record);
  check(`not flagged: "${evidenceText.slice(0, 45)}..."`, result.ok && result.output.review_flag === false);
}

console.log("\n== validateLeadAndEnforce rejects a malformed response ==\n");
const malformed = { lead_id: "LEAD-3003" };
const malformedResult = validateLeadAndEnforce(malformed, check3003.record);
check("malformed response is rejected, not passed through", malformedResult.ok === false);

console.log("\n== needs_human_input path correctly denies auto-send ==\n");
const needsInput = {
  lead_id: "LEAD-3003",
  scoring: { lead_score: "medium", evidence: ["ambiguous signal"], confidence: 40 },
  needs_human_input: true,
  human_question: "Some clarifying question?",
  recommended_action: { playbook_code: "standard_outreach", description: "Contact via preferred channel." },
  draft_message: null,
  review_flag: false
};
const needsInputResult = validateLeadAndEnforce(needsInput, check3003.record);
check("needs_human_input=true response validates ok", needsInputResult.ok === true);
check("computeAutoSend denies auto-send when needs_human_input is true", computeAutoSend(needsInputResult.output) === false);

console.log("\n== buildLeadReviewFallback shape ==\n");
const fallback = buildLeadReviewFallback(check3003.record, "test reason");
check("fallback always needs_human_input", fallback.needs_human_input === true);
check("fallback never carries a draft_message", fallback.draft_message === null);
check("fallback uses the new scoring.lead_score shape, not the old triage.priority_tier", fallback.scoring.lead_score === "medium");
check("computeAutoSend denies auto-send for the fallback", computeAutoSend(fallback) === false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
