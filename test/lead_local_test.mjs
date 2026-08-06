// test/lead_local_test.mjs
//
// Same pattern as local_test.mjs: offline coverage of
// lead_completeness_check.js + lead_validate.js, no API key, no browser.
// Run with: node test/lead_local_test.mjs

import { readFileSync } from "node:fs";
import { checkLeadCompleteness } from "../src/lead_completeness_check.js";
import { validateLeadAndEnforce, buildLeadReviewFallback } from "../src/lead_validate.js";

const leads = JSON.parse(readFileSync(new URL("../data/leads.json", import.meta.url)));

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`  ok   — ${label}`); }
  else { failed++; console.log(`  FAIL — ${label}`); }
}

const byId = (id) => leads.find((l) => l.lead_id === id);

console.log("== checkLeadCompleteness branches ==\n");
check("LEAD-3001 (no contact method) triggers skipLLM", checkLeadCompleteness(byId("LEAD-3001")).skipLLM === true);
check("LEAD-3002 (no contact method) triggers skipLLM", checkLeadCompleteness(byId("LEAD-3002")).skipLLM === true);
check("LEAD-3003 (has contact info) proceeds to LLM", checkLeadCompleteness(byId("LEAD-3003")).skipLLM === false);

const tier1SuvCheck = checkLeadCompleteness(byId("LEAD-3003"));
check("tier1 + SUV infers a 4h SLA", tier1SuvCheck.record.expected_sla_hours.value === 4);
check("SLA field is tagged inferred", tier1SuvCheck.record.expected_sla_hours.status === "inferred");

const tier18Check = checkLeadCompleteness(byId("LEAD-3018")); // city_tier omitted
check("missing city_tier defaults to tier2", tier18Check.record.city_tier.value === "tier2");
check("defaulted city_tier is tagged inferred", tier18Check.record.city_tier.status === "inferred");

console.log("\n== validateLeadAndEnforce against a well-formed response ==\n");
const check3003 = checkLeadCompleteness(byId("LEAD-3003"));
const goodResponse = {
  lead_id: "LEAD-3003",
  triage: {
    priority_tier: "critical",
    evidence: ["hours_since_qualified well exceeds the expected_sla_hours of 4 for a tier1 SUV lead"],
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

console.log("\n== validateLeadAndEnforce catches a tier/playbook mismatch ==\n");
const mismatch = { ...goodResponse, recommended_action: { ...goodResponse.recommended_action, playbook_code: "standard_outreach" } };
const mismatchResult = validateLeadAndEnforce(mismatch, check3003.record);
check("tier/playbook mismatch forces review_flag", mismatchResult.ok && mismatchResult.output.review_flag === true);

console.log("\n== validateLeadAndEnforce catches an unreachable channel ==\n");
const check3016 = checkLeadCompleteness(byId("LEAD-3016")); // phone-only
const badChannel = {
  lead_id: "LEAD-3016",
  triage: { priority_tier: "critical", evidence: ["overdue well past the expected 4h SLA for a tier1 SUV lead"], confidence: 85 },
  needs_human_input: false, human_question: null,
  recommended_action: { playbook_code: "immediate_call", description: "Call the lead within the hour and offer a same-day test drive slot." },
  draft_message: { channel: "email", text: "Following up on your SUV interest." }, // no email on file for this lead
  review_flag: false
};
const badChannelResult = validateLeadAndEnforce(badChannel, check3016.record);
check("unreachable channel forces review_flag", badChannelResult.ok && badChannelResult.output.review_flag === true);

console.log("\n== validateLeadAndEnforce catches fabricated evidence ==\n");
const fabricated = { ...goodResponse, triage: { ...goodResponse.triage, evidence: ["customer mentioned they test drove a competitor's electric pickup truck yesterday"] } };
const fabricatedResult = validateLeadAndEnforce(fabricated, check3003.record);
check("fabricated evidence forces review_flag", fabricatedResult.ok && fabricatedResult.output.review_flag === true);

console.log("\n== validateLeadAndEnforce rejects a malformed response ==\n");
const malformed = { lead_id: "LEAD-3003" };
const malformedResult = validateLeadAndEnforce(malformed, check3003.record);
check("malformed response is rejected, not passed through", malformedResult.ok === false);

console.log("\n== buildLeadReviewFallback shape ==\n");
const fallback = buildLeadReviewFallback(check3003.record, "test reason");
check("fallback always needs_human_input", fallback.needs_human_input === true);
check("fallback never carries a draft_message", fallback.draft_message === null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
