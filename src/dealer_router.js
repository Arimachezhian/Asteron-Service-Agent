/**
 * dealer_router.js
 *
 * Matches a lead to a dealer outlet. Deliberately NOT an LLM call —
 * this is a scoring/ranking problem with no genuine ambiguity to weigh
 * (city tier, vehicle specialization, current load, and track record
 * are all plain facts, not something requiring interpretation), so it
 * stays in the same "not everything needs AI" bucket as
 * completeness_check.js and detect_leads.mjs. Zero added latency, zero
 * added API cost, zero risk of recommending a dealer that doesn't
 * exist — a real advantage over routing through a model, worth stating
 * plainly rather than implying everything in this pipeline is AI.
 *
 * Scoring (out of a rough 0-100+ scale, not normalized — only the
 * relative ranking matters):
 *   +40  same city tier as the lead
 *   +15  adjacent city tier (tier1<->tier2 or tier2<->tier3, not tier1<->tier3)
 *   +30  dealer specializes in the lead's vehicle_category
 *   +0-20 inversely proportional to current_load (less loaded = higher score)
 *   +0-10 proportional to historical sla_compliance_pct
 *
 * Ties broken by lowest current_load — an idle-but-otherwise-equal
 * dealer beats a busy one.
 */

const TIER_ORDER = ["tier1", "tier2", "tier3"];

function tiersAreAdjacent(a, b) {
  const ia = TIER_ORDER.indexOf(a);
  const ib = TIER_ORDER.indexOf(b);
  if (ia === -1 || ib === -1) return false;
  return Math.abs(ia - ib) === 1;
}

// Accepts either a raw field object ({city_tier: "tier1", ...}) or a
// tagged record ({city_tier: {value: "tier1", ...}, ...}) — the same
// duality completeness_check.js's callers already have to handle.
function extractField(record, key, fallback) {
  const v = record?.[key];
  if (v && typeof v === "object" && "value" in v) return v.value ?? fallback;
  return v ?? fallback;
}

export function routeToDealer(record, dealers) {
  const cityTier = extractField(record, "city_tier", "tier2");
  const vehicleCategory = extractField(record, "vehicle_category", null);

  if (!dealers || dealers.length === 0 || !vehicleCategory) return null;

  const scored = dealers.map((d) => {
    const reasons = [];
    let score = 0;

    if (d.city_tier === cityTier) {
      score += 40;
      reasons.push(`same city tier (${cityTier})`);
    } else if (tiersAreAdjacent(d.city_tier, cityTier)) {
      score += 15;
      reasons.push(`nearby tier (${d.city_tier} vs. lead's ${cityTier})`);
    }

    if (Array.isArray(d.specializations) && d.specializations.includes(vehicleCategory)) {
      score += 30;
      reasons.push(`specializes in ${vehicleCategory}`);
    }

    const loadScore = Math.max(0, 20 - (d.current_load ?? 0) * 2);
    score += loadScore;
    reasons.push(`${d.current_load ?? "?"} active lead${d.current_load === 1 ? "" : "s"} right now`);

    const slaScore = ((d.sla_compliance_pct ?? 0) / 100) * 10;
    score += slaScore;
    reasons.push(`${d.sla_compliance_pct ?? "?"}% historical SLA compliance`);

    return { dealer: d, score, reasons };
  });

  scored.sort((a, b) => b.score - a.score || (a.dealer.current_load ?? 0) - (b.dealer.current_load ?? 0));
  const best = scored[0];

  return {
    dealer_id: best.dealer.dealer_id,
    dealer_name: best.dealer.name,
    city: best.dealer.city,
    city_tier: best.dealer.city_tier,
    current_load: best.dealer.current_load,
    sla_compliance_pct: best.dealer.sla_compliance_pct,
    match_score: Math.round(best.score),
    rationale: `Matched to ${best.dealer.name} (${best.dealer.city}) — ${best.reasons.join(", ")}.`
  };
}
