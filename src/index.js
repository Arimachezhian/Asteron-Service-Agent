/**
 * index.js — Cloudflare Worker entry point
 *
 * Wires reasoning-core into a single HTTP endpoint the dealer dashboard
 * (GitHub Pages, not yet built) will call. Implements the pipeline from
 * PROJECT_HANDOFF.md §4, stages 1-4 (Detection is upstream — a nightly
 * GitHub Action, not yet built — hands this Worker one flagged customer
 * record at a time; stages 5-7, human approval / send / feedback, are
 * frontend + automation concerns, also not yet built):
 *
 *   raw record -> checkCompleteness() -> [skipLLM ? stop here : ...]
 *              -> Gemini 2.5 Flash (Groq fallback) -> validateAndEnforce()
 *              -> JSON response
 *
 * Routes:
 *   POST /diagnose   body: one raw customer record (see test/example_records.json) — retention agent
 *   POST /triage      body: one raw lead record (see test/example_leads.json) — lead-response agent
 *   GET  /health      liveness check, no LLM call, reports which providers are configured
 *
 * CORS is wide open (Access-Control-Allow-Origin: *) since this is a
 * hackathon demo with no auth in front of it yet — see the root README's
 * "Not yet built / production hardening" note before exposing this
 * beyond a demo.
 */

import { checkCompleteness } from "./completeness_check.js";
import { buildSystemInstruction } from "./system_prompt.js";
import { diagnose as callLLM } from "./llm_client.js";
import { validateAndEnforce, buildReviewFallback } from "./validate.js";
import outputSchema from "./output_schema.json";

import { checkLeadCompleteness } from "./lead_completeness_check.js";
import { buildLeadSystemInstruction } from "./lead_system_prompt.js";
import { validateLeadAndEnforce, buildLeadReviewFallback } from "./lead_validate.js";
import leadOutputSchema from "./lead_output_schema.json";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        providers_configured: {
          gemini: Boolean(env.GEMINI_API_KEY),
          groq: Boolean(env.GROQ_API_KEY)
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/diagnose") {
      return handleDiagnose(request, env);
    }

    if (request.method === "POST" && url.pathname === "/triage") {
      return handleTriage(request, env);
    }

    return json({ ok: false, error: "Not found. POST /diagnose, POST /triage, or GET /health." }, 404);
  }
};

async function handleDiagnose(request, env) {
  let raw;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "Request body must be valid JSON." }, 400);
  }

  // Stage: deterministic completeness check. May resolve the whole
  // request without ever calling an LLM (skipLLM = true) — this is the
  // "no wasted API call, no guessing" behavior described in README.md.
  const check = checkCompleteness(raw);

  if (check.skipLLM) {
    return json({
      ok: true,
      llm_called: false,
      provider: null,
      needs_human_input: check.needsHumanInput,
      human_question: check.humanQuestion,
      record: check.record,
      output: null
    });
  }

  // Stage: LLM diagnosis (Gemini primary, Groq fallback).
  const systemInstruction = buildSystemInstruction(outputSchema);
  const userContent = JSON.stringify(check.record, null, 2);

  let parsed, provider;
  try {
    const result = await callLLM(systemInstruction, userContent, env);
    parsed = result.parsed;
    provider = result.provider;
  } catch (e) {
    // Both providers failed (or neither is configured). Never dead-end
    // the request — fall back to a human-review record so the dashboard
    // always has something actionable to show.
    return json({
      ok: true,
      llm_called: true,
      provider: null,
      needs_human_input: true,
      human_question: null,
      record: check.record,
      output: buildReviewFallback(check.record, `Diagnosis unavailable: ${e.message}`),
      validation_notes: [`Both LLM providers failed: ${e.message}`]
    });
  }

  // Stage: schema + worker-side validation. Never trust the model's JSON
  // on its own, even though generationConfig asked for structured output.
  const validated = validateAndEnforce(parsed, check.record);

  if (!validated.ok) {
    return json({
      ok: true,
      llm_called: true,
      provider,
      needs_human_input: true,
      human_question: null,
      record: check.record,
      output: validated.fallback,
      validation_notes: [validated.reason]
    });
  }

  return json({
    ok: true,
    llm_called: true,
    provider,
    needs_human_input: validated.output.needs_human_input,
    human_question: validated.output.human_question,
    record: check.record,
    output: validated.output,
    validation_notes: validated.notes
  });
}

// ----------------------------------------------------------------------
// Lead-response agent — same pipeline shape as handleDiagnose above,
// different reasoning-core module set (lead_* files). Kept as a
// separate function rather than a parameterized shared one: the two
// agents' record shapes, taxonomies, and validation rules are different
// enough that a shared abstraction would need almost as many branches
// as just having two functions — and two plain functions are easier to
// reason about under time pressure, and safer not to break the
// already-working /diagnose route while adding this one.
// ----------------------------------------------------------------------
async function handleTriage(request, env) {
  let raw;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "Request body must be valid JSON." }, 400);
  }

  const check = checkLeadCompleteness(raw);

  if (check.skipLLM) {
    return json({
      ok: true,
      llm_called: false,
      provider: null,
      needs_human_input: check.needsHumanInput,
      human_question: check.humanQuestion,
      record: check.record,
      output: null
    });
  }

  const systemInstruction = buildLeadSystemInstruction(leadOutputSchema);
  const userContent = JSON.stringify(check.record, null, 2);

  let parsed, provider;
  try {
    const result = await callLLM(systemInstruction, userContent, env);
    parsed = result.parsed;
    provider = result.provider;
  } catch (e) {
    return json({
      ok: true,
      llm_called: true,
      provider: null,
      needs_human_input: true,
      human_question: null,
      record: check.record,
      output: buildLeadReviewFallback(check.record, `Triage unavailable: ${e.message}`),
      validation_notes: [`Both LLM providers failed: ${e.message}`]
    });
  }

  const validated = validateLeadAndEnforce(parsed, check.record);

  if (!validated.ok) {
    return json({
      ok: true,
      llm_called: true,
      provider,
      needs_human_input: true,
      human_question: null,
      record: check.record,
      output: validated.fallback,
      validation_notes: [validated.reason]
    });
  }

  return json({
    ok: true,
    llm_called: true,
    provider,
    needs_human_input: validated.output.needs_human_input,
    human_question: validated.output.human_question,
    record: check.record,
    output: validated.output,
    validation_notes: validated.notes
  });
}
