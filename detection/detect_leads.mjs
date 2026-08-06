/**
 * detect_leads.mjs
 *
 * Rule-based Detection for the lead-response agent — same role as
 * detect.mjs plays for retention. No AI: pure threshold checks on hours
 * since qualification vs. the case's own response-time benchmarks.
 *
 * Run: node detection/detect_leads.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";

function hoursBetween(dateA, dateB) {
  return (new Date(dateB) - new Date(dateA)) / (1000 * 60 * 60);
}

function inferExpectedSlaHours(cityTier, vehicleCategory) {
  if (cityTier === "tier1" && vehicleCategory === "suv") return 4;
  if (cityTier === "tier1") return 8;
  return 24;
}

function computeFlags(lead, now) {
  const flags = [];
  if (!lead.qualified_at) return flags;

  const hoursSinceQualified = hoursBetween(lead.qualified_at, now);
  const cityTier = lead.city_tier ?? "tier2";
  const expectedSla = inferExpectedSlaHours(cityTier, lead.vehicle_category);

  if (!lead.contact_phone_available && !lead.contact_email_available) {
    flags.push("no_contact_method");
  }

  if ((lead.contact_attempts ?? 0) === 0 && hoursSinceQualified > expectedSla) {
    flags.push(`overdue: ${hoursSinceQualified.toFixed(1)}h since qualified, expected within ${expectedSla}h`);
  }

  if ((lead.contact_attempts ?? 0) >= 2 && !lead.test_drive_requested) {
    flags.push(`stalled: ${lead.contact_attempts} attempts, no test drive requested`);
  }

  if (cityTier === "tier1" && lead.vehicle_category === "suv") {
    flags.push("high_loss_segment: tier1 city + SUV interest");
  }

  if (lead.customer_type === "repeat" || lead.customer_type === "referral") {
    flags.push(`${lead.customer_type}_customer`);
  }

  return flags;
}

const now = new Date().toISOString();
const leads = JSON.parse(readFileSync(new URL("../data/leads.json", import.meta.url)));

const flagged = [];
for (const lead of leads) {
  const flags = computeFlags(lead, now);
  if (flags.length > 0) {
    const { _demo_intent, ...cleanLead } = lead;
    flagged.push({ lead_id: lead.lead_id, flags, record: cleanLead });
  }
}

const output = {
  generated_at: new Date().toISOString(),
  total_leads: leads.length,
  flagged_count: flagged.length,
  flagged
};

writeFileSync(new URL("../data/flagged_leads.json", import.meta.url), JSON.stringify(output, null, 2) + "\n");
console.log(`Detection run complete: ${flagged.length}/${leads.length} leads flagged.`);
for (const f of flagged) console.log(`  ${f.lead_id}: ${f.flags.join(", ")}`);
