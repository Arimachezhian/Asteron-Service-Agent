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
// Lead-response agent: same two-step flow (question -> answer -> triage
// -> approve), mocked /triage instead of /diagnose.
// ========================================================================
let leadFetchCallCount = 0;
dom.window.fetch = async (url) => {
  leadFetchCallCount++;
  if (url.endsWith("/triage") && leadFetchCallCount === 1) {
    return {
      ok: true,
      json: async () => ({
        ok: true, llm_called: false, provider: null,
        needs_human_input: true,
        human_question: "No phone or email on file for LEAD-3001. Do you have a way to reach this lead? (Phone / Email / Lead is unreachable)",
        record: {}, output: null
      })
    };
  }
  if (url.endsWith("/triage") && leadFetchCallCount === 2) {
    return {
      ok: true,
      json: async () => ({
        ok: true, llm_called: true, provider: "gemini-2.5-flash",
        needs_human_input: false, human_question: null, record: {},
        output: {
          lead_id: "LEAD-3001",
          triage: { priority_tier: "critical", evidence: ["overdue well past the expected 4h SLA for a tier1 SUV lead"], confidence: 88 },
          needs_human_input: false, human_question: null,
          recommended_action: { playbook_code: "immediate_call", description: "Call the lead within the hour and offer a same-day test drive slot." },
          draft_message: { channel: "call_brief", text: "Reach out about their SUV interest and offer a same-day test drive." },
          review_flag: false
        },
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

const runTriageBtn = document.getElementById("runTriageBtn");
check("Run triage button present for a pending lead", !!runTriageBtn);
runTriageBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 30));

check("first lead fetch call made", leadFetchCallCount === 1);
check("lead question box rendered", document.querySelector("#leadDetail .question-box") !== null);
const leadAnswerButtons = [...document.querySelectorAll("#leadAnswerRow [data-answer]")];
check("Phone/Email/Unreachable buttons rendered", leadAnswerButtons.map((b) => b.dataset.answer).join(",") === "Phone,Email,Unreachable");

const phoneBtn = leadAnswerButtons.find((b) => b.dataset.answer === "Phone");
phoneBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 30));

check("second lead fetch call made after answering", leadFetchCallCount === 2);
check("triage panel rendered after answer", document.querySelector("#leadDetail .evidence-list") !== null);
check("CRITICAL tier shown", document.getElementById("leadDetail").textContent.includes("CRITICAL"));
check("lead draft message textarea rendered", document.getElementById("leadDraftText") !== null);
check("lead job log recorded the answer + triage", document.getElementById("leadJobLog").textContent.includes("Dealer confirmed a phone number"));

const leadApproveBtn = [...document.querySelectorAll("#leadDetail [data-action=approve]")][0];
check("lead Approve button present", !!leadApproveBtn);
leadApproveBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 20));
check("lead status moved to approved", document.querySelector("#leadQueueList .ticket.selected")?.className.includes("status-approved"));

console.log(`\n${errors.length === 0 ? "ALL CHECKS PASSED (including lead flow)" : errors.length + " ISSUE(S) FOUND"}`);
process.exit(errors.length === 0 ? 0 : 1);
