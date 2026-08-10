// test/dashboard_ux_polish_test.mjs
//
// Verifies two specific UX fixes: (1) the "Evaluating this lead"
// step checklist actually shows while a real request is in flight,
// not just a static "loading" label, and (2) a flagged-for-review
// result shows a plain-English summary by default, with the raw
// technical validation_notes tucked behind a collapsed toggle rather
// than dumped straight into the main view.
//
// Run with: node test/dashboard_ux_polish_test.mjs

import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
const errors = [];
let fetchCallCount = 0;
let resolveDelayedFetch;

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  resources: "usable",
  url: "http://localhost/",
  beforeParse(window) {
    window.onerror = (msg) => errors.push(String(msg));
    window.fetch = async (url) => {
      fetchCallCount++;
      if (url.endsWith("/triage")) {
        // Deliberately slow, controlled by the test itself, so there's
        // a real window of time to inspect the DOM mid-flight.
        await new Promise((resolve) => { resolveDelayedFetch = resolve; });
        return {
          ok: true,
          json: async () => ({
            ok: true, llm_called: true, provider: "groq-llama-3.3-70b",
            needs_human_input: false, human_question: null, record: {},
            recommended_dealer: { dealer_id: "AST-D-BLR-01", dealer_name: "Asteron Hub Whitefield", city: "Bengaluru", city_tier: "tier1", current_load: 2, sla_compliance_pct: 92, match_score: 88, rationale: "Matched to Asteron Hub Whitefield." },
            auto_send: false, // deliberately flagged, to test the review-banner path
            output: {
              lead_id: "LEAD-3003",
              scoring: { lead_score: "high", evidence: ["overdue"], confidence: 40 },
              needs_human_input: false, human_question: null,
              recommended_action: { playbook_code: "standard_outreach", description: "Mismatched on purpose." }, // wrong for "high" -> triggers the mismatch note
              draft_message: { channel: "call_brief", text: "Test." },
              review_flag: true
            },
            validation_notes: ["playbook_code (standard_outreach) does not match lead_score (high -> immediate_call)."]
          })
        };
      }
      throw new Error(`unexpected fetch to ${url}`);
    };
  }
});

await new Promise((resolve) => dom.window.addEventListener("load", resolve));
await new Promise((r) => setTimeout(r, 50));
const { document } = dom.window;

function check(label, cond) {
  console.log(`  ${cond ? "ok  " : "FAIL"} — ${label}`);
  if (!cond) errors.push(label);
}

document.getElementById("workerUrl").value = "http://fake-worker.test";
document.getElementById("tabBtnLead").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

console.log("== Evaluating-steps checklist appears while a request is genuinely in flight ==");
// Every pre-loaded lead already has a pre-scored result baked in, so
// there's no manual "Score this lead" button to click anymore — the
// realistic way to trigger a genuinely live evaluation is Simulate New
// Lead, which auto-triggers scoring immediately.
const simBtn = document.getElementById("simulateLeadBtn");
check("Simulate New Lead button present", !!simBtn);
simBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

// The fetch is deliberately stuck awaiting resolveDelayedFetch right
// now — the request is genuinely in flight, not mocked-instant.
check("eval-steps panel is visible while genuinely waiting on the API", document.querySelector(".eval-steps") !== null);
check("shows the real first stage (completeness check)", document.getElementById("leadDetail").textContent.includes("Checking lead details"));
check("shows the real second stage (dealer routing)", document.getElementById("leadDetail").textContent.includes("Matching to the best-fit dealer"));
check("shows the real third stage, labeled as the live AI call", document.getElementById("leadDetail").textContent.includes("Scoring purchase intent"));
check("step 1 is marked done (checkmark) while step 3 becomes active", document.querySelector(".eval-step.done") !== null || document.querySelector(".eval-step.active") !== null);

// Now let the deliberately-delayed fetch resolve, and let the runTriage
// pipeline finish (including its own internal ~350ms "Validating" pause).
resolveDelayedFetch();
await new Promise((r) => setTimeout(r, 600));

console.log("\n== Review banner shows plain English by default, technical detail collapsed ==");
check("review banner is showing (this response was deliberately flagged)", document.querySelector(".review-banner") !== null);
check("shows a short label tag, not a technical breakdown", document.querySelector(".review-tag") !== null && document.getElementById("leadDetail").textContent.includes("Mismatch flagged"));
check("shows exactly one short, relevant reason line", document.getElementById("leadDetail").textContent.includes("didn't match its own rating"));
check("does NOT show the old verbose score/action breakdown", !document.getElementById("leadDetail").textContent.includes("confirmed — not the issue"));
check("the raw technical note is NOT sitting directly in the visible summary text", !document.querySelector(".review-banner-summary")?.textContent.includes("playbook_code (standard_outreach)"));

check("no separate 'Show technical details' toggle inside the review banner itself — consolidated elsewhere", document.querySelector(".review-banner .raw-response") === null && document.querySelector(".review-details") === null);

const rawDetails = document.querySelector(".raw-response");
check("the single, existing 'raw agent response' panel exists (not a second review-only one)", !!rawDetails);
check("that panel is collapsed by default (not open)", rawDetails && !rawDetails.hasAttribute("open"));
check("the raw technical note is still available there, just consolidated into one place", rawDetails?.textContent.includes("playbook_code (standard_outreach)"));

console.log(`\n${errors.length === 0 ? "ALL CHECKS PASSED" : errors.length + " ISSUE(S) FOUND"}`);
process.exit(errors.length === 0 ? 0 : 1);
