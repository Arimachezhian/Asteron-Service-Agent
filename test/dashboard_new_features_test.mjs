// Tests the features added for demo/UX impact: Simulate New Lead,
// queue sorting, and the live metrics strip. Separate
// from the existing smoke/flow tests so a failure here points straight
// at the new code, not the already-proven pipeline.
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
      // Always return a plausible HIGH-score, auto-sent response for
      // any /triage call in this test — we're testing the UI wiring
      // (fast-forward, simulate-lead, metrics, dealer panel), not the
      // model itself.
      return {
        ok: true,
        json: async () => ({
          ok: true, llm_called: true, provider: "groq-llama-3.3-70b",
          needs_human_input: false, human_question: null, record: {},
          auto_send: true,
          output: {
            lead_id: "TEST",
            scoring: { lead_score: "high", evidence: ["overdue"], confidence: 80 },
            needs_human_input: false, human_question: null,
            recommended_action: { playbook_code: "immediate_call", description: "Call now." },
            draft_message: { channel: "call_brief", text: "Test message." },
            review_flag: false
          },
          recommended_dealer: {
            dealer_id: "AST-D-BLR-01",
            dealer_name: "Asteron Hub Whitefield",
            city: "Bengaluru",
            city_tier: "tier1",
            current_load: 2,
            sla_compliance_pct: 92,
            match_score: 88,
            rationale: "Matched to Asteron Hub Whitefield (Bengaluru) — same city tier (tier1), specializes in suv, 2 active leads right now, 92% historical SLA compliance."
          },
          validation_notes: []
        })
      };
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

console.log("== metrics strip renders on load ==");
check("metrics strip element exists", document.getElementById("leadMetrics") !== null);
check("shows the 'how this queue works' framing, not raw case stats", document.getElementById("leadMetrics").textContent.includes("How this queue works"));
check("case-baseline stats are gone per explicit request", !document.getElementById("leadMetrics").textContent.includes("Case baseline"));

console.log("\n== SLA badges render on queue tickets ==");
check("at least one SLA badge rendered in the queue", document.querySelectorAll("#leadQueueList .sla-badge").length > 0);

console.log("\n== Simulate New Lead ==");
const beforeCount = document.querySelectorAll("#leadQueueList .ticket").length;
const simBtn = document.getElementById("simulateLeadBtn");
check("Simulate New Lead button exists", !!simBtn);
simBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 20));
const afterCount = document.querySelectorAll("#leadQueueList .ticket").length;
check("queue grew by exactly one ticket", afterCount === beforeCount + 1);
check("new lead auto-selected", document.getElementById("leadDetail").textContent.includes("LEAD-SIM-1"));
check("simulated lead has a customer name shown", /Rohan|Priya|Arjun|Sneha|Vikram|Ananya|Karan|Divya/.test(document.getElementById("leadDetail").textContent));

// Simulate a second one to confirm the counter increments correctly and
// doesn't collide with the first.
simBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 20));
check("second simulated lead gets a distinct ID", document.getElementById("leadDetail").textContent.includes("LEAD-SIM-2"));
check("queue now has two more tickets than at start", document.querySelectorAll("#leadQueueList .ticket").length === beforeCount + 2);
await new Promise((r) => setTimeout(r, 500)); // covers the deliberate ~350ms "Validating" pause, plus the auto-triggered scoring call resolving
check("simulated lead auto-scores immediately, no manual click needed", document.getElementById("leadDetail").textContent.includes("HIGH") || document.getElementById("leadDetail").textContent.includes("sent automatically"));

console.log("\n== Sort order ==");
check("default sort is 'Newest first'", document.getElementById("leadSortSelect").value === "newest");

// LEAD-SIM-1/2 were created moments ago (qualified_at = now); every
// pre-loaded flagged lead has a qualified_at from hours in the past —
// under "Newest first" (the default), the simulated ones should always
// rank above any pre-loaded lead, with zero manual sorting needed.
function ticketOrder() {
  return [...document.querySelectorAll("#leadQueueList .ticket")].map((t) => t.dataset.id);
}
const newestOrder = ticketOrder();
const simIndex = newestOrder.indexOf("LEAD-SIM-1");
const preloadedIndex = newestOrder.indexOf("LEAD-3001");
check("a freshly simulated lead ranks above a pre-loaded one under 'Newest first'", simIndex !== -1 && preloadedIndex !== -1 && simIndex < preloadedIndex);

const sortSelect = document.getElementById("leadSortSelect");
sortSelect.value = "overdue";
sortSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
const overdueOrder = ticketOrder();
check("switching sort mode actually changes queue order", JSON.stringify(newestOrder) !== JSON.stringify(overdueOrder));

sortSelect.value = "score";
sortSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
check("'Score' sort mode is selectable without error", sortSelect.value === "score");
sortSelect.value = "newest";
sortSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

console.log("\n== metrics strip reflects the queue's actual score distribution ==");
check("queue-level HIGH count is non-zero (simulated leads scored high in this test's mock)", /High[\s\S]*?[1-9]/.test(document.getElementById("leadMetrics").textContent));

console.log("\n== dealer recommendation panel ==");
check("recommended dealer name appears in the detail panel", document.getElementById("leadDetail").textContent.includes("Asteron Hub Whitefield"));
check("dealer panel shows the 'no AI call' tag", document.getElementById("leadDetail").textContent.includes("deterministic match, no AI call"));
check("dealer panel shows the rationale sentence", document.getElementById("leadDetail").textContent.includes("historical SLA compliance"));
check("dealer panel shows current load", document.getElementById("leadDetail").textContent.includes("2 active leads"));

console.log("\n== Reset session clears simulated leads ==");
document.getElementById("resetBtn").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 20));
check("queue count back to original after reset", document.querySelectorAll("#leadQueueList .ticket").length === beforeCount);

console.log(`\n${errors.length === 0 ? "ALL CHECKS PASSED" : errors.length + " ISSUE(S) FOUND"}`);
process.exit(errors.length === 0 ? 0 : 1);
