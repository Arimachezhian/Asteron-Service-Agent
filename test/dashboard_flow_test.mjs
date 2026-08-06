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
process.exit(errors.length === 0 ? 0 : 1);
