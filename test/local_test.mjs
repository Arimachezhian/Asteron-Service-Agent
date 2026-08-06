// test/local_test.mjs
//
// Offline sanity check for the parts of the pipeline that don't need a
// live API key: completeness_check.js against example_records.json, and
// validate.js against hand-built good/bad fake model responses. This is
// what reasoning-core/README.md refers to as already "verified against
// test data" — re-run here after porting to ESM to confirm nothing broke
// in translation, plus new coverage for validate.js's four
// worker-side rules.
//
// Run with: npm run test:local

import { readFileSync } from "node:fs";
import { checkCompleteness } from "../src/completeness_check.js";
import { validateAndEnforce, buildReviewFallback } from "../src/validate.js";

const records = JSON.parse(readFileSync(new URL("./example_records.json", import.meta.url)));

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) {
    passed++;
    console.log(`  ok   — ${label}`);
  } else {
    failed++;
    console.log(`  FAIL — ${label}`);
  }
}

console.log("== completeness_check.js against example_records.json ==\n");
for (const rec of records) {
  const result = checkCompleteness(rec);
  console.log(`${rec.customer_id}`);
  console.log(`  expected: ${rec._expected_outcome}`);
  console.log(`  actual:   skipLLM=${result.skipLLM}, needsHumanInput=${result.needsHumanInput}`);
  if (result.humanQuestion) console.log(`  question: ${result.humanQuestion}`);
  console.log("");
}

check("AST-10432 (never visited) triggers skipLLM", checkCompleteness(records[0]).skipLLM === true);
check("AST-10891 (cost complaint) proceeds to LLM", checkCompleteness(records[1]).skipLLM === false);
check("AST-11207 (no sentiment signal) triggers skipLLM", checkCompleteness(records[2]).skipLLM === true);

console.log("\n== validate.js against a well-formed fake model response ==\n");
const goodRecordCheck = checkCompleteness(records[1]); // AST-10891, category B expected
const goodResponse = {
  customer_id: "AST-10891",
  diagnosis: {
    primary_category: "B",
    secondary_category: null,
    evidence: ["complaint_text references the bill being higher than the quote and feeling not informed"],
    confidence: 85
  },
  needs_human_input: false,
  human_question: null,
  recommended_action: {
    playbook_code: "transparent_quote",
    description: "Offer a fixed-price, itemized, photo-documented estimate ahead of the next visit.",
    requires_human_review_only: false
  },
  draft_message: {
    channel: "email",
    text: "Hi — ahead of your next visit we'd like to share a fixed, itemized quote so there are no surprises on the bill.",
    discount_offered: 500
  },
  review_flag: false
};
const goodResult = validateAndEnforce(goodResponse, goodRecordCheck.record);
check("well-formed response validates ok", goodResult.ok === true);
check("review_flag stays false when everything is grounded", goodResult.output.review_flag === false);
check("draft_message survives for a non-D, non-human-input case", goodResult.output.draft_message !== null);

console.log("\n== validate.js catches a discount outside authorized_discount_range ==\n");
const badDiscountResponse = {
  ...goodResponse,
  draft_message: { ...goodResponse.draft_message, discount_offered: 50000 }
};
const badDiscountResult = validateAndEnforce(badDiscountResponse, goodRecordCheck.record);
check(
  "out-of-range discount forces review_flag",
  badDiscountResult.ok && badDiscountResult.output.review_flag === true
);

console.log("\n== validate.js catches a fabricated evidence citation ==\n");
const badEvidenceResponse = {
  ...goodResponse,
  diagnosis: { ...goodResponse.diagnosis, evidence: ["customer said the car caught fire on the highway"] }
};
const badEvidenceResult = validateAndEnforce(badEvidenceResponse, goodRecordCheck.record);
check(
  "fabricated evidence forces review_flag",
  badEvidenceResult.ok && badEvidenceResult.output.review_flag === true
);

console.log("\n== validate.js strips draft_message for escalate_human_only (category D) ==\n");
const categoryDResponse = {
  ...goodResponse,
  diagnosis: { ...goodResponse.diagnosis, primary_category: "D", evidence: ["repeated complaint about the same issue"] },
  recommended_action: {
    playbook_code: "escalate_human_only",
    description: "Escalate to the service manager for direct human review.",
    requires_human_review_only: false // deliberately wrong, to test the belt-and-suspenders fix
  }
};
const categoryDResult = validateAndEnforce(categoryDResponse, goodRecordCheck.record);
check("category D never carries a draft_message", categoryDResult.ok && categoryDResult.output.draft_message === null);
check(
  "category D forces requires_human_review_only=true even if the model said false",
  categoryDResult.ok && categoryDResult.output.recommended_action.requires_human_review_only === true
);

console.log("\n== validate.js catches a playbook_code that doesn't match primary_category ==\n");
const mismatchedResponse = {
  ...goodResponse,
  diagnosis: { ...goodResponse.diagnosis, primary_category: "C" },
  recommended_action: { ...goodResponse.recommended_action, playbook_code: "transparent_quote" }
};
const mismatchedResult = validateAndEnforce(mismatchedResponse, goodRecordCheck.record);
check(
  "category/playbook mismatch forces review_flag",
  mismatchedResult.ok && mismatchedResult.output.review_flag === true
);

console.log("\n== validate.js rejects a structurally malformed response ==\n");
const malformed = { customer_id: "AST-10891" }; // missing everything else
const malformedResult = validateAndEnforce(malformed, goodRecordCheck.record);
check("malformed response is rejected, not passed through", malformedResult.ok === false);
check("malformed response produces a usable fallback", malformedResult.fallback.needs_human_input === true);

console.log("\n== buildReviewFallback shape ==\n");
const fallback = buildReviewFallback(goodRecordCheck.record, "test reason");
check("fallback always needs_human_input", fallback.needs_human_input === true);
check("fallback always routes to escalate_human_only", fallback.recommended_action.playbook_code === "escalate_human_only");
check("fallback never carries a draft_message", fallback.draft_message === null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
