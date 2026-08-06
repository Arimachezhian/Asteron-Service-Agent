/**
 * build_dataset.mjs
 *
 * Produces data/customers.json: 24 synthetic customer records for the
 * demo. Every record is hand-designed (via `_demo_intent`, a
 * documentation-only field the pipeline ignores), not randomly sampled —
 * a live demo needs known-good expected outcomes, not a coin flip on
 * whether a given record happens to exercise something interesting.
 * Together they:
 *
 *   - Hit every branch completeness_check.js can take (both skipLLM
 *     triggers, plus the normal proceed-to-LLM path)
 *   - Give at least 2 examples pointing toward each of the six diagnosis
 *     categories (A-F) from system_prompt.md's taxonomy
 *   - Land close to (not exactly) the case's own fragmentation stats:
 *     ~38% unified_id_present, ~58% "complete" records (no missing
 *     optional field) — see the summary printed at the end
 *
 * Dates are computed relative to *run time* (monthsAgo helper), not
 * hardcoded, so the dataset stays meaningful (warranty proximity,
 * service-overdue windows) no matter when it's regenerated.
 *
 * Run: node data/build_dataset.mjs
 */

import { writeFileSync } from "node:fs";

function monthsAgo(n) {
  if (n === null) return null;
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

// customer_id, vehicle_category are hard-required; everything else can
// be deliberately null/omitted to simulate real-world incompleteness.
const records = [
  // --- skipLLM: never visited, delivery-booking status unknown -------
  {
    _demo_intent: "skipLLM -> delivery-booking question (never visited, booking status unknown)",
    customer_id: "AST-20001", vehicle_category: "suv",
    purchase_date: monthsAgo(2), last_service_date: null, service_visit_count: 0,
    complaint_text: [], survey_scores: [], app_last_login_date: monthsAgo(1),
    first_service_booked_at_delivery: null, unified_id_present: false,
    authorized_discount_range: [0, 1500]
  },
  {
    _demo_intent: "skipLLM -> delivery-booking question (never visited, booking status unknown)",
    customer_id: "AST-20002", vehicle_category: "ev",
    purchase_date: monthsAgo(1), last_service_date: null, service_visit_count: 0,
    complaint_text: [], survey_scores: [], app_last_login_date: null,
    first_service_booked_at_delivery: null, unified_id_present: false,
    authorized_discount_range: [0, 1500]
  },

  // --- skipLLM: visited but zero sentiment signal ---------------------
  {
    _demo_intent: "skipLLM -> concerns question (has visits, no complaint/survey on record)",
    customer_id: "AST-20003", vehicle_category: "sedan",
    purchase_date: monthsAgo(14), last_service_date: monthsAgo(10), service_visit_count: 1,
    complaint_text: [], survey_scores: [], app_last_login_date: monthsAgo(9),
    first_service_booked_at_delivery: true, unified_id_present: true,
    authorized_discount_range: [0, 2000]
  },
  {
    _demo_intent: "skipLLM -> concerns question (has visits, no complaint/survey on record)",
    customer_id: "AST-20004", vehicle_category: "hatchback",
    purchase_date: monthsAgo(20), last_service_date: monthsAgo(15), service_visit_count: 2,
    complaint_text: [], survey_scores: [], app_last_login_date: monthsAgo(18),
    first_service_booked_at_delivery: true, unified_id_present: false,
    authorized_discount_range: [0, 1200]
  },
  {
    _demo_intent: "skipLLM -> concerns question (fully complete otherwise, to show completeness isn't the only gate)",
    customer_id: "AST-20024", vehicle_category: "ev",
    purchase_date: monthsAgo(16), last_service_date: monthsAgo(13), service_visit_count: 1,
    complaint_text: [], survey_scores: [], app_last_login_date: monthsAgo(2),
    first_service_booked_at_delivery: true, unified_id_present: false,
    authorized_discount_range: [0, 1800]
  },

  // --- Category B: cost / transparency distrust -----------------------
  {
    _demo_intent: "-> category B (cost complaint, complete record)",
    customer_id: "AST-20005", vehicle_category: "hatchback",
    purchase_date: monthsAgo(24), last_service_date: monthsAgo(3), service_visit_count: 2,
    complaint_text: ["Visit on record: customer said the final bill was much higher than the quote and felt not informed beforehand."],
    survey_scores: [{ visit_date: monthsAgo(3), score: 3, comment: "unexpected charges" }],
    app_last_login_date: monthsAgo(4), first_service_booked_at_delivery: true,
    unified_id_present: false, authorized_discount_range: [0, 2000]
  },
  {
    _demo_intent: "-> category B (cost complaint, unified ID missing)",
    customer_id: "AST-20006", vehicle_category: "suv",
    purchase_date: monthsAgo(18), last_service_date: monthsAgo(5), service_visit_count: 1,
    complaint_text: ["Customer felt uninformed about a charge added to the service bill without prior notice."],
    survey_scores: [{ visit_date: monthsAgo(5), score: 4, comment: "surprised by add-on charge" }],
    app_last_login_date: monthsAgo(6), first_service_booked_at_delivery: true,
    unified_id_present: false, authorized_discount_range: [0, 1500]
  },
  {
    _demo_intent: "-> category B, incomplete record (missing app_last_login_date)",
    customer_id: "AST-20018", vehicle_category: "suv",
    purchase_date: monthsAgo(22), last_service_date: monthsAgo(7), service_visit_count: 2,
    complaint_text: ["Customer said the estimate quoted on the phone did not match the amount charged at pickup."],
    survey_scores: [{ visit_date: monthsAgo(7), score: 3, comment: "cost mismatch" }],
    app_last_login_date: null, first_service_booked_at_delivery: true,
    unified_id_present: false, authorized_discount_range: [0, 1600]
  },
  {
    _demo_intent: "-> category B, fully complete",
    customer_id: "AST-20022", vehicle_category: "suv",
    purchase_date: monthsAgo(19), last_service_date: monthsAgo(2), service_visit_count: 3,
    complaint_text: ["Customer raised concern that pricing wasn't explained clearly before work started."],
    survey_scores: [{ visit_date: monthsAgo(2), score: 4, comment: "unclear pricing" }],
    app_last_login_date: monthsAgo(2), first_service_booked_at_delivery: true,
    unified_id_present: false, authorized_discount_range: [0, 1700]
  },

  // --- Category C: convenience / wait-time friction --------------------
  {
    _demo_intent: "-> category C (wait-time complaint, complete record)",
    customer_id: "AST-20007", vehicle_category: "sedan",
    purchase_date: monthsAgo(15), last_service_date: monthsAgo(4), service_visit_count: 2,
    complaint_text: ["Customer complained about a long wait and being unable to get a convenient appointment slot."],
    survey_scores: [{ visit_date: monthsAgo(4), score: 3, comment: "slow, no slots available" }],
    app_last_login_date: null, first_service_booked_at_delivery: true,
    unified_id_present: true, authorized_discount_range: [0, 1800]
  },
  {
    _demo_intent: "-> category C (appointment delay)",
    customer_id: "AST-20008", vehicle_category: "suv",
    purchase_date: monthsAgo(11), last_service_date: monthsAgo(2), service_visit_count: 1,
    complaint_text: ["Customer said the appointment was delayed significantly beyond the scheduled time."],
    survey_scores: [], app_last_login_date: monthsAgo(3),
    first_service_booked_at_delivery: true, unified_id_present: false,
    authorized_discount_range: [0, 1400]
  },
  {
    _demo_intent: "-> category C, incomplete record (missing app_last_login_date)",
    customer_id: "AST-20020", vehicle_category: "ev",
    purchase_date: monthsAgo(13), last_service_date: monthsAgo(6), service_visit_count: 2,
    complaint_text: ["Customer noted they could not get a slot for two weeks and found the wait inconvenient."],
    survey_scores: [{ visit_date: monthsAgo(6), score: 3, comment: "wait too long" }],
    app_last_login_date: null, first_service_booked_at_delivery: true,
    unified_id_present: true, authorized_discount_range: [0, 1900]
  },

  // --- Category D: genuine quality dissatisfaction ----------------------
  {
    _demo_intent: "-> category D (repeated complaint, same issue)",
    customer_id: "AST-20009", vehicle_category: "ev",
    purchase_date: monthsAgo(10), last_service_date: monthsAgo(1), service_visit_count: 3,
    complaint_text: [
      "First visit: customer reported the charging port connection felt loose and intermittent.",
      "Second visit, same issue: customer said the charging port fault was not fully resolved and recurred."
    ],
    survey_scores: [{ visit_date: monthsAgo(1), score: 2, comment: "same charging fault again" }],
    app_last_login_date: monthsAgo(1), first_service_booked_at_delivery: true,
    unified_id_present: true, authorized_discount_range: [0, 2500]
  },
  {
    _demo_intent: "-> category D (low survey score tied to a specific visit)",
    customer_id: "AST-20010", vehicle_category: "hatchback",
    purchase_date: monthsAgo(9), last_service_date: monthsAgo(2), service_visit_count: 2,
    complaint_text: ["Customer reported a rattling noise from the dashboard was not fixed after the visit."],
    survey_scores: [{ visit_date: monthsAgo(2), score: 1, comment: "issue not fixed, very unhappy" }],
    app_last_login_date: monthsAgo(3), first_service_booked_at_delivery: true,
    unified_id_present: false, authorized_discount_range: [0, 1300]
  },
  {
    _demo_intent: "-> category D, incomplete record (missing authorized_discount_range)",
    customer_id: "AST-20019", vehicle_category: "sedan",
    purchase_date: monthsAgo(12), last_service_date: monthsAgo(1), service_visit_count: 2,
    complaint_text: [
      "Customer reported a persistent AC noise.",
      "Return visit: customer said the same AC noise is still present after the repair."
    ],
    survey_scores: [{ visit_date: monthsAgo(1), score: 2, comment: "same noise as before" }],
    app_last_login_date: monthsAgo(2), first_service_booked_at_delivery: true,
    unified_id_present: true, authorized_discount_range: null
  },

  // --- Category A: delivery handoff failure (booking explicitly false, ---
  // --- not unknown — so this does NOT trigger the skipLLM branch) --------
  {
    _demo_intent: "-> category A (booking explicitly declined, not unknown; no complaint on record)",
    customer_id: "AST-20011", vehicle_category: "sedan",
    purchase_date: monthsAgo(5), last_service_date: null, service_visit_count: 0,
    complaint_text: [], survey_scores: [], app_last_login_date: monthsAgo(4),
    first_service_booked_at_delivery: false, unified_id_present: false,
    authorized_discount_range: [0, 1000]
  },
  {
    _demo_intent: "-> category A (booking explicitly declined)",
    customer_id: "AST-20012", vehicle_category: "suv",
    purchase_date: monthsAgo(8), last_service_date: null, service_visit_count: 0,
    complaint_text: [], survey_scores: [], app_last_login_date: monthsAgo(7),
    first_service_booked_at_delivery: false, unified_id_present: true,
    authorized_discount_range: [0, 1500]
  },
  {
    _demo_intent: "-> category A, incomplete record (missing app_last_login_date)",
    customer_id: "AST-20023", vehicle_category: "sedan",
    purchase_date: monthsAgo(6), last_service_date: null, service_visit_count: 0,
    complaint_text: [], survey_scores: [], app_last_login_date: null,
    first_service_booked_at_delivery: false, unified_id_present: false,
    authorized_discount_range: [0, 1100]
  },

  // --- Category E: silent drift (a dealer follow-up note already on ------
  // --- file, simulating a record that already passed the skipLLM --------
  // --- concerns-question stage once) -------------------------------------
  {
    _demo_intent: "-> category E (silent drift; complaint_text pre-populated with a 'no concerns' dealer note so it doesn't re-trigger skipLLM)",
    customer_id: "AST-20015", vehicle_category: "suv",
    purchase_date: monthsAgo(28), last_service_date: monthsAgo(16), service_visit_count: 2,
    complaint_text: ["Dealer follow-up: no concerns were raised by the customer during their visit(s)."],
    survey_scores: [], app_last_login_date: monthsAgo(20),
    first_service_booked_at_delivery: true, unified_id_present: false,
    authorized_discount_range: [0, 1600]
  },
  {
    _demo_intent: "-> category E (silent drift, complete record otherwise)",
    customer_id: "AST-20016", vehicle_category: "ev",
    purchase_date: monthsAgo(22), last_service_date: monthsAgo(14), service_visit_count: 1,
    complaint_text: ["Dealer follow-up: no concerns were raised by the customer during their visit(s)."],
    survey_scores: [], app_last_login_date: null,
    first_service_booked_at_delivery: true, unified_id_present: true,
    authorized_discount_range: [0, 2200]
  },

  // --- Category F: competitive defection risk (warranty proximity) -------
  {
    _demo_intent: "-> category F (approaching warranty expiry, price-sensitive profile, app inactive)",
    customer_id: "AST-20013", vehicle_category: "hatchback",
    purchase_date: monthsAgo(34), last_service_date: monthsAgo(19), service_visit_count: 1,
    complaint_text: [], survey_scores: [], app_last_login_date: monthsAgo(21),
    first_service_booked_at_delivery: true, unified_id_present: false,
    authorized_discount_range: [0, 900]
  },
  {
    _demo_intent: "-> category F (past warranty window, thin engagement)",
    customer_id: "AST-20014", vehicle_category: "sedan",
    purchase_date: monthsAgo(40), last_service_date: monthsAgo(24), service_visit_count: 1,
    complaint_text: [], survey_scores: [], app_last_login_date: monthsAgo(26),
    first_service_booked_at_delivery: true, unified_id_present: true,
    authorized_discount_range: [0, 1000]
  },
  {
    _demo_intent: "-> category F, fully complete record",
    customer_id: "AST-20021", vehicle_category: "hatchback",
    purchase_date: monthsAgo(33), last_service_date: monthsAgo(18), service_visit_count: 1,
    complaint_text: [], survey_scores: [], app_last_login_date: monthsAgo(19),
    first_service_booked_at_delivery: true, unified_id_present: true,
    authorized_discount_range: [0, 1100]
  },

  // --- Mixed-signal record: tests secondary_category handling ------------
  {
    _demo_intent: "-> genuinely mixed B/C signal (tests secondary_category)",
    customer_id: "AST-20017", vehicle_category: "hatchback",
    purchase_date: monthsAgo(17), last_service_date: monthsAgo(5), service_visit_count: 3,
    complaint_text: [
      "Customer complained the estimate was higher than quoted.",
      "Customer also mentioned the wait for a service slot was longer than expected."
    ],
    survey_scores: [{ visit_date: monthsAgo(5), score: 3, comment: "cost and wait, both frustrating" }],
    app_last_login_date: monthsAgo(6), first_service_booked_at_delivery: true,
    unified_id_present: false, authorized_discount_range: [0, 2000]
  }
];

writeFileSync(
  new URL("./customers.json", import.meta.url),
  JSON.stringify(records, null, 2) + "\n"
);

// --- Self-reporting summary, so the achieved mix is transparent rather --
// --- than an unverified claim -------------------------------------------
const total = records.length;
const unifiedCount = records.filter((r) => r.unified_id_present).length;
const optionalFields = ["last_service_date", "app_last_login_date", "authorized_discount_range"];
const completeCount = records.filter((r) => optionalFields.every((f) => r[f] !== null && r[f] !== undefined)).length;

console.log(`Wrote ${total} records to data/customers.json`);
console.log(`  unified_id_present: ${unifiedCount}/${total} = ${((unifiedCount / total) * 100).toFixed(1)}% (case figure: 38%)`);
console.log(`  "complete" records (no missing optional field): ${completeCount}/${total} = ${((completeCount / total) * 100).toFixed(1)}% (case figure: 58%)`);
