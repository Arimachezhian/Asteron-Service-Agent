/**
 * score_leads.mjs
 *
 * Pre-scores every flagged lead by calling the REAL, deployed Worker's
 * /triage endpoint — genuine Gemini/Groq calls, not mocked — BEFORE the
 * dashboard is built. This is what makes the job queue show up already
 * rated (High/Medium/Low) and, where eligible, already acknowledged the
 * instant a dealer opens the dashboard: scoring happens the moment a
 * lead is captured, not the moment someone happens to click a button.
 *
 * Sequential, not parallel, with a short pause between calls — gentle
 * on free-tier rate limits (both providers' free tiers have genuinely
 * been hit during testing; no reason to risk repeating that here).
 *
 * "Simulate new lead" and "Fast-forward" in the dashboard still trigger
 * real, on-demand live calls — that's deliberate, those two features
 * exist specifically to show the live process happening on camera. This
 * script only covers the pre-loaded queue, so the queue itself opens
 * already-handled rather than sitting there waiting to be worked one
 * click at a time.
 *
 * Run: node detection/score_leads.mjs --worker-url=https://your-worker.workers.dev
 */

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const workerUrlArg = args.find((a) => a.startsWith("--worker-url="));
if (!workerUrlArg) {
  console.error("Usage: node detection/score_leads.mjs --worker-url=https://your-worker.workers.dev");
  process.exit(1);
}
const workerUrl = workerUrlArg.split("=").slice(1).join("=").replace(/\/+$/, "");

const flaggedFile = JSON.parse(readFileSync(new URL("../data/flagged_leads.json", import.meta.url), "utf8"));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function scoreLead(record) {
  const start = Date.now();
  const resp = await fetch(`${workerUrl}/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record)
  });
  if (!resp.ok) throw new Error(`Worker responded ${resp.status}`);
  const body = await resp.json();
  body._elapsedMs = Date.now() - start;
  return body;
}

const scored = [];
console.log(`Scoring ${flaggedFile.flagged.length} leads against ${workerUrl} ...\n`);

for (const entry of flaggedFile.flagged) {
  try {
    const result = await scoreLead(entry.record);
    scored.push({ lead_id: entry.lead_id, flags: entry.flags, record: entry.record, result });
    const summary = result.output
      ? `${result.output.scoring.lead_score.toUpperCase()}${result.auto_send ? " — auto-sent" : result.output.review_flag ? " — flagged for review" : ""}`
      : "needs dealer input before scoring can even start";
    console.log(`  ${entry.lead_id}: ${summary} (${result.provider || "n/a"}, ${result._elapsedMs}ms)`);
  } catch (e) {
    console.error(`  ${entry.lead_id}: FAILED — ${e.message}`);
    scored.push({ lead_id: entry.lead_id, flags: entry.flags, record: entry.record, result: { ok: false, error: e.message } });
  }
  await sleep(400); // gentle pacing — avoid re-triggering a free-tier rate limit
}

const output = {
  generated_at: new Date().toISOString(),
  worker_url: workerUrl,
  total_scored: scored.length,
  scored
};

writeFileSync(new URL("../data/scored_leads.json", import.meta.url), JSON.stringify(output, null, 2) + "\n");

const autoSent = scored.filter((s) => s.result?.auto_send).length;
const needsReview = scored.filter((s) => s.result?.output?.review_flag).length;
const needsInput = scored.filter((s) => s.result?.needs_human_input && !s.result?.output).length;

console.log(`\nWrote data/scored_leads.json`);
console.log(`  ${autoSent} auto-acknowledged, ${needsReview} flagged for review, ${needsInput} need dealer input before scoring can run at all.`);
console.log(`\nNext: node dashboard/build.mjs --worker-url=${workerUrl}`);
