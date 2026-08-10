// Exercises the two-step "dealer answers a question, then diagnosis
// renders" flow end to end with a mocked Worker, since that's the
// trickiest interactive path and the one most likely to break silently.
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
const errors = [];
let fetchCallCount = 0;

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  resources: "usable",
  url: "http://localhost/",
  beforeParse(window) {
    window.onerror = (msg) => errors.push(String(msg));
    window.fetch = async (url) => {
      fetchCallCount++;
      if (url.endsWith("/diagnose") && fetchCallCount === 1) {
        // First call: simulate the skipLLM branch (never-visited customer).
        return {
          ok: true,
          json: async () => ({
            ok: true, llm_called: false, provider: null,
            needs_human_input: true,
            human_question: "Was a first service appointment booked for AST-20001 at the time of delivery? (Yes / No / Unsure)",
            record: {}, output: null
          })
        };
      }
      if (url.endsWith("/diagnose") && fetchCallCount === 2) {
        // Second call (after the dealer answers "No"): simulate a real
        // category-A diagnosis coming back.
        return {
          ok: true,
          json: async () => ({
            ok: true, llm_called: true, provider: "gemini-2.5-flash",
            needs_human_input: false, human_question: null, record: {},
            output: {
              customer_id: "AST-20001",
              diagnosis: { primary_category: "A", secondary_category: null, evidence: ["no first service booked, no complaint on record"], confidence: 85 },
              needs_human_input: false, human_question: null,
              recommended_action: { playbook_code: "schedule_warm_call", description: "Route to the customer's original selling advisor for a warm call plus a complimentary inspection offer.", requires_human_review_only: false },
              draft_message: { channel: "call_brief", text: "Reach out to welcome the customer and offer to book their first service.", discount_offered: null },
              review_flag: false
            },
            validation_notes: []
          })
        };
      }
      throw new Error(`unexpected fetch #${fetchCallCount} to ${url}`);
    };
  }
});

// Reassigned below once we're testing the lead flow — see fetchCallCount reset.

await new Promise((resolve) => dom.window.addEventListener("load", resolve));
await new Promise((r) => setTimeout(r, 50));
const { document } = dom.window;

function check(label, cond) {
  console.log(`  ${cond ? "ok  " : "FAIL"} — ${label}`);
  if (!cond) errors.push(label);
}

document.getElementById("workerUrl").value = "http://fake-worker.test";

// Select AST-20001 (the first never-visited / delivery-booking-unknown record).
const ticket = [...document.querySelectorAll(".ticket")].find((t) => t.dataset.id === "AST-20001");
check("found AST-20001 in the queue", !!ticket);
ticket.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

const runBtn = document.getElementById("runDiagBtn");
check("Run diagnosis button present for a pending job", !!runBtn);
runBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 30));

check("first fetch call made", fetchCallCount === 1);
check("question box rendered", document.querySelector(".question-box") !== null);
check("question text shown", document.querySelector(".question-box p")?.textContent.includes("at the time of delivery"));
const answerButtons = [...document.querySelectorAll("#answerRow [data-answer]")];
check("Yes/No/Unsure buttons rendered for delivery question", answerButtons.map((b) => b.dataset.answer).join(",") === "Yes,No,Unsure");

const noBtn = answerButtons.find((b) => b.dataset.answer === "No");
noBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 30));

check("second fetch call made after answering", fetchCallCount === 2);
check("diagnosis panel rendered after answer", document.querySelector(".evidence-list") !== null);
check("category A shown", document.getElementById("detail").textContent.includes("Delivery handoff failure"));
check("draft message textarea rendered", document.getElementById("draftText") !== null);
check("job log recorded the answer + diagnosis", document.getElementById("jobLog").textContent.includes("Dealer answered delivery-booking question"));

const approveBtn = [...document.querySelectorAll("[data-action=approve]")][0];
check("Approve button present", !!approveBtn);
approveBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 20));
check("status moved to approved after clicking Approve", document.querySelector(".ticket.selected")?.className.includes("status-approved"));
check("no window errors across the whole flow", errors.filter((e) => !e.includes("expected") ).length === errors.length && errors.length === 0);

console.log(`\n${errors.length === 0 ? "ALL CHECKS PASSED" : errors.length + " ISSUE(S) FOUND"}`);

// ========================================================================
// Lead-response agent: with pre-scoring, LEAD-3001 (no phone, no email
// on file) should ALREADY show its "no contact method" question the
// instant it's selected — this comes from the embedded PRESCORED_RESULTS
// baked in at build time, no fetch, no button click. That skipLLM
// outcome is deterministic (a pure completeness_check.js rule, not an
// AI judgment call), so it's identical regardless of which real
// scoring run produced the embedded data. Only the SECOND step —
// answering the question — triggers an actual (mocked, here) live call.
// ========================================================================
let leadFetchCallCount = 0;
dom.window.fetch = async (url) => {
  leadFetchCallCount++;
  if (url.endsWith("/triage") && leadFetchCallCount === 1) {
    return {
      ok: true,
      json: async () => ({
        ok: true, llm_called: true, provider: "groq-llama-3.3-70b",
        needs_human_input: false, human_question: null, record: {},
        recommended_dealer: {
          dealer_id: "AST-D-BLR-01", dealer_name: "Asteron Hub Whitefield", city: "Bengaluru",
          city_tier: "tier1", current_load: 2, sla_compliance_pct: 92, match_score: 88,
          rationale: "Matched to Asteron Hub Whitefield (Bengaluru) — same city tier (tier1), specializes in suv, 2 active leads right now, 92% historical SLA compliance."
        },
        auto_send: true,
        output: {
          lead_id: "LEAD-3001",
          scoring: { lead_score: "high", evidence: ["overdue well past the expected 4h SLA for a tier1 SUV lead"], confidence: 88 },
          needs_human_input: false, human_question: null,
          recommended_action: { playbook_code: "immediate_call", description: "Call the lead within the hour and offer a same-day test drive slot." },
          draft_message: { channel: "call_brief", text: "Hi! Thanks for your interest in the SUV — Asteron Hub Whitefield will reach out within 4 hours to arrange a test drive." },
          review_flag: false
        },
        _elapsedMs: 1200,
        validation_notes: []
      })
    };
  }
  throw new Error(`unexpected lead fetch #${leadFetchCallCount} to ${url}`);
};

document.getElementById("tabBtnLead").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
const leadTicket = [...document.querySelectorAll("#leadQueueList .ticket")].find((t) => t.dataset.id === "LEAD-3001");
check("found LEAD-3001 in the lead queue", !!leadTicket);
leadTicket.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

check("no fetch call needed just to see the pre-scored question", leadFetchCallCount === 0);
check("lead question box already rendered from pre-scored data, no click needed", document.querySelector("#leadDetail .question-box") !== null);
const leadAnswerButtons = [...document.querySelectorAll("#leadAnswerRow [data-answer]")];
check("Phone/Email/Unreachable buttons rendered", leadAnswerButtons.map((b) => b.dataset.answer).join(",") === "Phone,Email,Unreachable");

const phoneBtn = leadAnswerButtons.find((b) => b.dataset.answer === "Phone");
phoneBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 500)); // covers the deliberate ~350ms "Validating" pause added to runTriage

check("answering the question triggers exactly one live fetch call", leadFetchCallCount === 1);
check("scoring panel rendered after answer", document.querySelector("#leadDetail .evidence-list") !== null);
check("HIGH score shown", document.getElementById("leadDetail").textContent.includes("HIGH"));
check("job log recorded the answer + auto-send", document.getElementById("leadJobLog").textContent.includes("Dealer confirmed a phone number"));
check("job log confirms the message was auto-sent, not just scored", document.getElementById("leadJobLog").textContent.includes("sent automatically"));

// This response auto-sends (review_flag: false, needs_human_input: false)
// — the whole point of the new flow — so there should be NO manual
// Approve/Edit/Reject controls, no editable textarea, and the status
// should land on the new "auto_sent" state, not "diagnosed".
check("no Approve button when auto-sent (nothing left to approve)", document.querySelectorAll("#leadDetail [data-action=approve]").length === 0);
check("no editable draft textarea when auto-sent (already delivered, read-only)", document.getElementById("leadDraftText") === null);
check("sent message text is shown read-only", document.getElementById("leadDetail").textContent.includes("Asteron Hub Whitefield will reach out"));
check("auto-sent banner explains why no click was needed", document.getElementById("leadDetail").textContent.includes("sent automatically"));
check("status lands on auto_sent, not diagnosed", document.querySelector("#leadQueueList .ticket.selected")?.className.includes("status-auto_sent"));

// Dealer routing rides along with the same response, independent of
// the auto-send decision — should be visible regardless.
check("recommended dealer panel shows the matched dealer", document.getElementById("leadDetail").textContent.includes("Asteron Hub Whitefield"));
check("dealer panel explicitly notes no AI call was used for routing", document.getElementById("leadDetail").textContent.includes("deterministic match, no AI call"));

console.log("\n== pre-scored queue state (no interaction at all) ==");
// LEAD-3005 was pre-scored "high" and auto-sent in the mock data used
// to build this dashboard — should already show that in the queue list
// itself, with zero clicks.
const preScoredTicket = [...document.querySelectorAll("#leadQueueList .ticket")].find((t) => t.dataset.id === "LEAD-3005");
check("a pre-scored lead shows a score badge directly in the queue, unclicked", preScoredTicket?.querySelector(".score-badge") !== null);
check("a pre-scored lead's queue status is not the generic 'pending'", !preScoredTicket?.className.includes("status-pending"));

console.log(`\n${errors.length === 0 ? "ALL CHECKS PASSED (including lead flow)" : errors.length + " ISSUE(S) FOUND"}`);
process.exit(errors.length === 0 ? 0 : 1);
