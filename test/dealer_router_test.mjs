// test/dealer_router_test.mjs
// Pure function, no API, no async — tests the routing math directly.
// Run with: node test/dealer_router_test.mjs

import { readFileSync } from "node:fs";
import { routeToDealer } from "../src/dealer_router.js";

const directory = JSON.parse(readFileSync(new URL("../src/dealer_directory.json", import.meta.url)));
const dealers = directory.dealers;

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`  ok   — ${label}`); }
  else { failed++; console.log(`  FAIL — ${label}`); }
}

console.log("== basic matching ==\n");

// Tier1 SUV lead should land on a tier1 dealer that specializes in SUVs
// and has the best combination of low load + high SLA compliance.
const r1 = routeToDealer({ city_tier: "tier1", vehicle_category: "suv" }, dealers);
check("tier1 SUV lead routes to a tier1 dealer", r1.city_tier === "tier1");
check("tier1 SUV lead routes to an SUV-specializing dealer", dealers.find((d) => d.dealer_id === r1.dealer_id).specializations.includes("suv"));
check("tier1 SUV lead picks Asteron Hub Whitefield (best combo: SUV-only specialist, load 2, 92% SLA)", r1.dealer_id === "AST-D-BLR-01");

console.log("\n== tier fallback ==\n");
// No tier3 dealer specializes in "ev" — should still return *some*
// dealer (the least-bad option), never null, for a category no local
// dealer handles perfectly.
const r2 = routeToDealer({ city_tier: "tier3", vehicle_category: "ev" }, dealers);
check("still returns a dealer even with no perfect specialization match in-tier", r2 !== null);

console.log("\n== accepts both raw and tagged record shapes ==\n");
const rawShape = routeToDealer({ city_tier: "tier2", vehicle_category: "sedan" }, dealers);
const taggedShape = routeToDealer({ city_tier: { value: "tier2", status: "observed" }, vehicle_category: { value: "sedan", status: "observed" } }, dealers);
check("raw and tagged record shapes produce the same routing decision", rawShape.dealer_id === taggedShape.dealer_id);

console.log("\n== defaults and edge cases ==\n");
const noCityTier = routeToDealer({ vehicle_category: "hatchback" }, dealers);
check("missing city_tier defaults to tier2 rather than throwing", noCityTier !== null);

const noVehicle = routeToDealer({ city_tier: "tier1" }, dealers);
check("missing vehicle_category returns null rather than a nonsense match", noVehicle === null);

const emptyDirectory = routeToDealer({ city_tier: "tier1", vehicle_category: "suv" }, []);
check("empty dealer directory returns null, not a crash", emptyDirectory === null);

console.log("\n== rationale and fields ==\n");
check("result includes a human-readable rationale string", typeof r1.rationale === "string" && r1.rationale.length > 10);
check("rationale mentions the dealer name", r1.rationale.includes(r1.dealer_name));
check("result includes match_score as a number", typeof r1.match_score === "number");

console.log("\n== load sensitivity ==\n");
// Two dealers, same tier, same specialization, different load — the
// less-loaded one should win when everything else is close.
const lightLoad = [{ dealer_id: "A", name: "Dealer A", city: "X", city_tier: "tier1", specializations: ["suv"], current_load: 1, sla_compliance_pct: 80 }];
const heavyLoad = [{ dealer_id: "B", name: "Dealer B", city: "Y", city_tier: "tier1", specializations: ["suv"], current_load: 9, sla_compliance_pct: 80 }];
const rLight = routeToDealer({ city_tier: "tier1", vehicle_category: "suv" }, lightLoad);
const rHeavy = routeToDealer({ city_tier: "tier1", vehicle_category: "suv" }, heavyLoad);
check("a lightly-loaded dealer scores higher than an identical but heavily-loaded one", rLight.match_score > rHeavy.match_score);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
