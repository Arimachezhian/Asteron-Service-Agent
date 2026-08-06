/**
 * build.mjs
 *
 * Fills dashboard/index.template.html's three placeholders with real
 * data and writes dashboard/index.html:
 *
 *   __FLAGGED_DATA__      <- data/flagged_customers.json's `flagged` array
 *   __CATEGORY_META__     <- derived from src/playbook.json (single
 *                            source of truth, per its own description
 *                            field: "the system prompt and the dashboard
 *                            UI both read from this file so the playbook
 *                            can never drift out of sync")
 *   __WORKER_URL_DEFAULT__ <- optional, via --worker-url= flag
 *
 * The generated index.html is a static snapshot of whatever
 * flagged_customers.json contained at build time — it does not fetch
 * live data at runtime. That's a deliberate demo-scope tradeoff (see
 * README): embedding avoids CORS/file:// friction and makes the page
 * work as a single self-contained artifact. Re-run this after every
 * detection run to pick up a fresh flagged list.
 *
 * Run: node dashboard/build.mjs [--worker-url=https://your-worker.workers.dev]
 */

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const workerUrlArg = args.find((a) => a.startsWith("--worker-url="));
const workerUrl = workerUrlArg ? workerUrlArg.split("=").slice(1).join("=") : "";

const template = readFileSync(new URL("./index.template.html", import.meta.url), "utf8");
const flaggedFile = JSON.parse(readFileSync(new URL("../data/flagged_customers.json", import.meta.url), "utf8"));
const playbook = JSON.parse(readFileSync(new URL("../src/playbook.json", import.meta.url), "utf8"));
const flaggedLeadsFile = JSON.parse(readFileSync(new URL("../data/flagged_leads.json", import.meta.url), "utf8"));
const leadPlaybook = JSON.parse(readFileSync(new URL("../src/lead_playbook.json", import.meta.url), "utf8"));

const categoryMeta = {};
for (const cat of playbook.categories) {
  categoryMeta[cat.code] = { name: cat.name, playbook_code: cat.playbook_code };
}

const tierMeta = {};
for (const tier of leadPlaybook.tiers) {
  tierMeta[tier.code] = { name: tier.name, playbook_code: tier.playbook_code };
}

let output = template
  .replace("/*__FLAGGED_DATA__*/[]", JSON.stringify(flaggedFile.flagged))
  .replace("/*__CATEGORY_META__*/{}", JSON.stringify(categoryMeta))
  .replace("/*__FLAGGED_LEADS_DATA__*/[]", JSON.stringify(flaggedLeadsFile.flagged))
  .replace("/*__TIER_META__*/{}", JSON.stringify(tierMeta))
  .replace('/*__WORKER_URL_DEFAULT__*/""', JSON.stringify(workerUrl));

writeFileSync(new URL("./index.html", import.meta.url), output);

console.log(`Built dashboard/index.html`);
console.log(`  embedded ${flaggedFile.flagged.length} flagged customers (as of ${flaggedFile.as_of_date})`);
console.log(`  embedded ${Object.keys(categoryMeta).length} category definitions from playbook.json`);
console.log(`  embedded ${flaggedLeadsFile.flagged.length} flagged leads`);
console.log(`  embedded ${Object.keys(tierMeta).length} priority-tier definitions from lead_playbook.json`);
console.log(`  default Worker URL: ${workerUrl || "(none — dealer enters it in the dashboard)"}`);
