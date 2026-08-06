/**
 * build_leads_dataset.mjs
 *
 * Same approach as build_dataset.mjs: curated, not random. 18 leads,
 * each designed to land in a specific branch of
 * lead_completeness_check.js or point toward a specific priority tier,
 * with a spread across city tiers and vehicle segments matching the
 * case's own "loss concentrated in top-20 cities and SUVs" framing.
 *
 * Run: node data/build_leads_dataset.mjs
 */

import { writeFileSync } from "node:fs";

function hoursAgo(n) {
  if (n === null) return null;
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d.toISOString();
}

const leads = [
  // --- skipLLM: no contact method on file --------------------------------
  {
    _demo_intent: "skipLLM -> no contact method",
    lead_id: "LEAD-3001", vehicle_category: "suv", source: "digital",
    qualified_at: hoursAgo(30), city_tier: "tier1",
    contact_phone_available: false, contact_email_available: false,
    contact_attempts: 0, last_contact_attempt_at: null,
    customer_type: "new", test_drive_requested: false, notes: []
  },
  {
    _demo_intent: "skipLLM -> no contact method",
    lead_id: "LEAD-3002", vehicle_category: "hatchback", source: "walk-in",
    qualified_at: hoursAgo(5), city_tier: "tier2",
    contact_phone_available: false, contact_email_available: false,
    contact_attempts: 0, last_contact_attempt_at: null,
    customer_type: "new", test_drive_requested: false, notes: []
  },

  // --- critical: overdue + tier1 + SUV ------------------------------------
  {
    _demo_intent: "-> critical (overdue, tier1 SUV)",
    lead_id: "LEAD-3003", vehicle_category: "suv", source: "digital",
    qualified_at: hoursAgo(28), city_tier: "tier1",
    contact_phone_available: true, contact_email_available: true,
    contact_attempts: 0, last_contact_attempt_at: null,
    customer_type: "new", test_drive_requested: false, notes: []
  },
  {
    _demo_intent: "-> critical (overdue, repeat customer)",
    lead_id: "LEAD-3004", vehicle_category: "sedan", source: "referral",
    qualified_at: hoursAgo(30), city_tier: "tier2",
    contact_phone_available: true, contact_email_available: false,
    contact_attempts: 0, last_contact_attempt_at: null,
    customer_type: "repeat", test_drive_requested: false, notes: []
  },
  {
    _demo_intent: "-> critical (overdue, referral, tier1)",
    lead_id: "LEAD-3005", vehicle_category: "ev", source: "referral",
    qualified_at: hoursAgo(26), city_tier: "tier1",
    contact_phone_available: true, contact_email_available: true,
    contact_attempts: 0, last_contact_attempt_at: null,
    customer_type: "referral", test_drive_requested: false, notes: []
  },

  // --- high: overdue, standard segment ------------------------------------
  {
    _demo_intent: "-> high (overdue, standard segment, tier2 hatchback)",
    lead_id: "LEAD-3006", vehicle_category: "hatchback", source: "digital",
    qualified_at: hoursAgo(30), city_tier: "tier2",
    contact_phone_available: true, contact_email_available: true,
    contact_attempts: 0, last_contact_attempt_at: null,
    customer_type: "new", test_drive_requested: false, notes: []
  },
  {
    _demo_intent: "-> high (overdue, tier1 sedan — not the SUV segment)",
    lead_id: "LEAD-3007", vehicle_category: "sedan", source: "digital",
    qualified_at: hoursAgo(10), city_tier: "tier1",
    contact_phone_available: true, contact_email_available: false,
    contact_attempts: 0, last_contact_attempt_at: null,
    customer_type: "new", test_drive_requested: false, notes: []
  },
  {
    _demo_intent: "-> high (overdue, tier3)",
    lead_id: "LEAD-3008", vehicle_category: "suv", source: "walk-in",
    qualified_at: hoursAgo(27), city_tier: "tier3",
    contact_phone_available: true, contact_email_available: true,
    contact_attempts: 0, last_contact_attempt_at: null,
    customer_type: "new", test_drive_requested: false, notes: []
  },

  // --- standard: within SLA window ----------------------------------------
  {
    _demo_intent: "-> standard (within 24h window, tier2)",
    lead_id: "LEAD-3009", vehicle_category: "hatchback", source: "digital",
    qualified_at: hoursAgo(6), city_tier: "tier2",
    contact_phone_available: true, contact_email_available: true,
    contact_attempts: 0, last_contact_attempt_at: null,
    customer_type: "new", test_drive_requested: false, notes: []
  },
  {
    _demo_intent: "-> standard (within tight tier1 SUV window)",
    lead_id: "LEAD-3010", vehicle_category: "suv", source: "digital",
    qualified_at: hoursAgo(2), city_tier: "tier1",
    contact_phone_available: true, contact_email_available: true,
    contact_attempts: 0, last_contact_attempt_at: null,
    customer_type: "new", test_drive_requested: true, notes: []
  },
  {
    _demo_intent: "-> standard (within window, tier3)",
    lead_id: "LEAD-3011", vehicle_category: "sedan", source: "walk-in",
    qualified_at: hoursAgo(4), city_tier: "tier3",
    contact_phone_available: true, contact_email_available: false,
    contact_attempts: 0, last_contact_attempt_at: null,
    customer_type: "new", test_drive_requested: false, notes: []
  },
  {
    _demo_intent: "-> standard (within window, ev, referral but not yet overdue)",
    lead_id: "LEAD-3012", vehicle_category: "ev", source: "referral",
    qualified_at: hoursAgo(3), city_tier: "tier2",
    contact_phone_available: true, contact_email_available: true,
    contact_attempts: 0, last_contact_attempt_at: null,
    customer_type: "referral", test_drive_requested: false, notes: []
  },

  // --- nurture: repeated attempts, no engagement --------------------------
  {
    _demo_intent: "-> nurture (2 attempts, no test drive, gone quiet)",
    lead_id: "LEAD-3013", vehicle_category: "hatchback", source: "digital",
    qualified_at: hoursAgo(200), city_tier: "tier2",
    contact_phone_available: true, contact_email_available: true,
    contact_attempts: 2, last_contact_attempt_at: hoursAgo(96),
    customer_type: "new", test_drive_requested: false,
    notes: ["Attempt 1: no answer.", "Attempt 2: asked to be contacted later, no follow-up since."]
  },
  {
    _demo_intent: "-> nurture (3 attempts, cold)",
    lead_id: "LEAD-3014", vehicle_category: "sedan", source: "digital",
    qualified_at: hoursAgo(300), city_tier: "tier3",
    contact_phone_available: true, contact_email_available: true,
    contact_attempts: 3, last_contact_attempt_at: hoursAgo(120),
    customer_type: "new", test_drive_requested: false,
    notes: ["Attempt 1: no answer.", "Attempt 2: no answer.", "Attempt 3: said not ready to decide yet."]
  },
  {
    _demo_intent: "-> nurture (2 attempts, tier1 SUV but genuinely disengaged — tests critical-vs-nurture conflict)",
    lead_id: "LEAD-3015", vehicle_category: "suv", source: "digital",
    qualified_at: hoursAgo(250), city_tier: "tier1",
    contact_phone_available: true, contact_email_available: true,
    contact_attempts: 2, last_contact_attempt_at: hoursAgo(80),
    customer_type: "new", test_drive_requested: false,
    notes: ["Attempt 1: no answer.", "Attempt 2: said they'd already bought elsewhere, but didn't explicitly close the lead."]
  },

  // --- edge cases: only-phone / only-email --------------------------------
  {
    _demo_intent: "-> critical, phone-only lead (tests channel-availability guardrail)",
    lead_id: "LEAD-3016", vehicle_category: "suv", source: "walk-in",
    qualified_at: hoursAgo(29), city_tier: "tier1",
    contact_phone_available: true, contact_email_available: false,
    contact_attempts: 0, last_contact_attempt_at: null,
    customer_type: "new", test_drive_requested: false, notes: []
  },
  {
    _demo_intent: "-> standard, email-only lead (tests channel-availability guardrail)",
    lead_id: "LEAD-3017", vehicle_category: "hatchback", source: "digital",
    qualified_at: hoursAgo(5), city_tier: "tier2",
    contact_phone_available: false, contact_email_available: true,
    contact_attempts: 0, last_contact_attempt_at: null,
    customer_type: "new", test_drive_requested: false, notes: []
  },
  {
    _demo_intent: "-> standard, city_tier unspecified (tests the tier2 default inference)",
    lead_id: "LEAD-3018", vehicle_category: "sedan", source: "digital",
    qualified_at: hoursAgo(5), city_tier: undefined,
    contact_phone_available: true, contact_email_available: true,
    contact_attempts: 0, last_contact_attempt_at: null,
    customer_type: "new", test_drive_requested: false, notes: []
  }
];

// Strip undefined keys (JSON.stringify drops them anyway, but this keeps
// the written file's shape explicit rather than accidentally implicit).
const cleaned = leads.map((l) => {
  const copy = { ...l };
  if (copy.city_tier === undefined) delete copy.city_tier;
  return copy;
});

writeFileSync(new URL("./leads.json", import.meta.url), JSON.stringify(cleaned, null, 2) + "\n");
console.log(`Wrote ${cleaned.length} leads to data/leads.json`);
