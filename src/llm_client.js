/**
 * llm_client.js
 *
 * Calls Gemini 2.5 Flash first (primary, per PROJECT_HANDOFF.md: 1,500
 * req/day free, no card, 1M token context). Falls back to Groq's
 * llama-3.3-70b on ANY Gemini failure — network error, non-2xx, quota
 * exhausted, or unparsable output — so a live demo doesn't die mid-run
 * because of one provider's rate limit. Same prompt/record sent to both;
 * only the request/response shape differs per provider's API.
 */

const GEMINI_URL = (model, apiKey) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

function stripCodeFences(text) {
  return text
    .trim()
    .replace(/^```(json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

function tryParseJSON(text) {
  try {
    return JSON.parse(stripCodeFences(text));
  } catch {
    return null;
  }
}

async function callGemini(systemPrompt, userContent, apiKey, model = "gemini-2.5-flash") {
  const resp = await fetch(GEMINI_URL(model, apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userContent }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    })
  });

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => "");
    throw new Error(`Gemini ${resp.status}: ${bodyText.slice(0, 300)}`);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? "";
  const parsed = tryParseJSON(text);
  if (!parsed) throw new Error("Gemini returned unparsable JSON");
  return parsed;
}

async function callGroq(systemPrompt, userContent, apiKey, model = "llama-3.3-70b-versatile") {
  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ]
    })
  });

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => "");
    throw new Error(`Groq ${resp.status}: ${bodyText.slice(0, 300)}`);
  }

  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  const parsed = tryParseJSON(text);
  if (!parsed) throw new Error("Groq returned unparsable JSON");
  return parsed;
}

/**
 * Tries Gemini, then Groq, in order. Returns { parsed, provider } on
 * success. Throws only if both providers fail (or aren't configured) —
 * the caller (index.js) turns that into a review_flag=true fallback
 * rather than a 500, so a request never dead-ends with an opaque error.
 */
export async function diagnose(systemPrompt, userContent, env) {
  const errors = [];

  if (env.GEMINI_API_KEY) {
    try {
      const parsed = await callGemini(systemPrompt, userContent, env.GEMINI_API_KEY);
      return { parsed, provider: "gemini-2.5-flash" };
    } catch (e) {
      errors.push(`gemini: ${e.message}`);
    }
  } else {
    errors.push("gemini: no GEMINI_API_KEY configured");
  }

  if (env.GROQ_API_KEY) {
    try {
      const parsed = await callGroq(systemPrompt, userContent, env.GROQ_API_KEY);
      return { parsed, provider: "groq-llama-3.3-70b" };
    } catch (e) {
      errors.push(`groq: ${e.message}`);
    }
  } else {
    errors.push("groq: no GROQ_API_KEY configured");
  }

  throw new Error(`All providers failed — ${errors.join(" | ")}`);
}
