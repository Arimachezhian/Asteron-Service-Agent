/**
 * build.mjs
 *
 * Fills dashboard/index.template.html's placeholders with real data and
 * writes dashboard/index.html.
 *
 * NEW requirement: data/scored_leads.json must exist before this runs
 * (produced by `node detection/score_leads.mjs --worker-url=...`) — the
 * job queue is meant to open already-rated and, where eligible,
 * already-acknowledged, not sitting there waiting for someone to click
 * a button per lead. This build script embeds those pre-computed
 * results (__PRESCORED_RESULTS__) alongside the raw flagged-lead data,
 * so the dashboard can apply them the instant it loads.
 *
 * The generated index.html is a static snapshot of whatever the source
 * files contained at build time — it does not fetch live data at
 * runtime. Deliberate demo-scope tradeoff: avoids CORS/file:// friction,
 * keeps the page a single self-contained artifact. Re-run detection,
 * then score_leads, then this, to pick up fresh data.
 *
 * Run: node dashboard/build.mjs [--worker-url=https://your-worker.workers.dev]
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const workerUrlArg = args.find((a) => a.startsWith("--worker-url="));
const workerUrl = workerUrlArg ? workerUrlArg.split("=").slice(1).join("=") : "";

const scoredLeadsPath = new URL("../data/scored_leads.json", import.meta.url);
if (!existsSync(scoredLeadsPath)) {
  console.error("ERROR: data/scored_leads.json not found.");
  console.error("Run this first: node detection/score_leads.mjs --worker-url=https://your-worker.workers.dev");
  console.error("The job queue needs pre-scored results baked in — it should never open unscored.");
  process.exit(1);
}

const template = readFileSync(new URL("./index.template.html", import.meta.url), "utf8");
const flaggedFile = JSON.parse(readFileSync(new URL("../data/flagged_customers.json", import.meta.url), "utf8"));
const playbook = JSON.parse(readFileSync(new URL("../src/playbook.json", import.meta.url), "utf8"));
const flaggedLeadsFile = JSON.parse(readFileSync(new URL("../data/flagged_leads.json", import.meta.url), "utf8"));
const leadPlaybook = JSON.parse(readFileSync(new URL("../src/lead_playbook.json", import.meta.url), "utf8"));
const scoredLeadsFile = JSON.parse(readFileSync(scoredLeadsPath, "utf8"));

const categoryMeta = {};
for (const cat of playbook.categories) {
  categoryMeta[cat.code] = { name: cat.name, playbook_code: cat.playbook_code };
}

const tierMeta = {};
for (const tier of leadPlaybook.scores) {
  tierMeta[tier.code] = { name: tier.name, playbook_code: tier.playbook_code };
}

// lead_id -> full /triage response body, so the dashboard can apply
// each lead's already-computed result at load time instead of waiting
// for a click.
const prescoredResults = {};
for (const s of scoredLeadsFile.scored) {
  if (s.result && s.result.ok !== false) prescoredResults[s.lead_id] = s.result;
}

let output = template
  .replace("/*__FLAGGED_DATA__*/[]", JSON.stringify(flaggedFile.flagged))
  .replace("/*__CATEGORY_META__*/{}", JSON.stringify(categoryMeta))
  .replace("/*__FLAGGED_LEADS_DATA__*/[]", JSON.stringify(flaggedLeadsFile.flagged))
  .replace("/*__TIER_META__*/{}", JSON.stringify(tierMeta))
  .replace("/*__PRESCORED_RESULTS__*/{}", JSON.stringify(prescoredResults))
  .replace('/*__WORKER_URL_DEFAULT__*/""', JSON.stringify(workerUrl));

writeFileSync(new URL("./index.html", import.meta.url), output);

console.log(`Built dashboard/index.html`);
console.log(`  embedded ${flaggedFile.flagged.length} flagged customers (as of ${flaggedFile.as_of_date})`);
console.log(`  embedded ${Object.keys(categoryMeta).length} category definitions from playbook.json`);
console.log(`  embedded ${flaggedLeadsFile.flagged.length} flagged leads`);
console.log(`  embedded ${Object.keys(tierMeta).length} lead-score definitions from lead_playbook.json`);
console.log(`  embedded ${Object.keys(prescoredResults).length} pre-scored results (from ${scoredLeadsFile.generated_at})`);
console.log(`  default Worker URL: ${workerUrl || "(none — dealer enters it in the dashboard)"}`);
