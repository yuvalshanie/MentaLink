// Utility wrapper for the custom LLM provider (LLMod.ai).
//
// LLMod.ai is assumed to expose an OpenAI-compatible REST API:
//   POST {LLMOD_BASE_URL}/chat/completions
//   POST {LLMOD_BASE_URL}/embeddings
// The base URL is configurable via the LLMOD_BASE_URL environment variable
// so the endpoint can be corrected without code changes.
//
// Server-side only: the API key is read from process.env and is never
// logged or returned to the client.

export const TEXT_MODEL = "MB5R2CF-azure/gpt-5.4-mini";
export const EMBEDDING_MODEL = "MB5R2CF-azure/text-embedding-3-small";

const DEFAULT_BASE_URL = "https://api.llmod.ai/v1";
// 40s per call keeps the worst case (3 agent calls + up to 3 repair calls +
// 1 embedding call = 7 requests) under Vercel's 300-second limit.
const REQUEST_TIMEOUT_MS = Number(process.env.LLMOD_TIMEOUT_MS || 40_000);

function getConfig() {
  const apiKey = process.env.LLMOD_API_KEY;
  if (!apiKey) {
    throw new Error(
      "LLMOD_API_KEY is not configured. Set it in the server environment."
    );
  }
  const baseUrl = (process.env.LLMOD_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/+$/,
    ""
  );
  return { apiKey, baseUrl };
}

// Provider/Azure content-filter rejections (typically HTTP 400). The raw
// provider body is inspected here ONLY to classify the error — it is never
// placed on the thrown error and never reaches logs or the client.
const CONTENT_POLICY_MARKERS =
  /content_filter|content[ _-]?policy|contentpolicyviolation|responsibleaipolicyviolation|\bfiltered\b|safety system|content management policy/i;

const CONTENT_POLICY_CODE = "llmod_content_policy";

/** True when an error came from the provider's content filter. */
export function isContentPolicyError(error) {
  return error?.code === CONTENT_POLICY_CODE;
}

async function llmodFetch(path, body) {
  const { apiKey, baseUrl } = getConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("The language-model request timed out. Please try again.");
    }
    throw new Error("The language-model service could not be reached.");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Read the provider body for classification only — never expose it.
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    if (CONTENT_POLICY_MARKERS.test(detail)) {
      const error = new Error(
        "The language model declined to process this content."
      );
      error.code = CONTENT_POLICY_CODE;
      error.status = res.status;
      throw error;
    }
    // Neutral message: no provider body, endpoint path, or internals.
    throw new Error(
      `The language-model service returned an error (HTTP ${res.status}).`
    );
  }
  return res.json();
}

/**
 * Calls the text generation model.
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>} The model's text response.
 */
export async function callTextModel(systemPrompt, userPrompt) {
  const data = await llmodFetch("/chat/completions", {
    model: TEXT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("LLMod text model returned an empty or invalid response.");
  }
  return content;
}

/**
 * Calls the embedding model.
 * @param {string} text
 * @returns {Promise<number[]>} The embedding vector.
 */
export async function callEmbeddingModel(text) {
  const data = await llmodFetch("/embeddings", {
    model: EMBEDDING_MODEL,
    input: text,
  });
  const vector = data?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("LLMod embedding model returned an invalid embedding.");
  }
  return vector;
}

/**
 * Extracts a JSON object from raw model output.
 * Handles code fences and surrounding prose without extra LLM calls.
 * @param {string} raw
 * @returns {any|null} Parsed value, or null when parsing failed.
 */
export function extractJson(raw) {
  if (typeof raw !== "string") return null;
  const candidates = [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(raw);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(raw.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim());
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/**
 * Calls the text model expecting a JSON object response.
 * Performs at most one controlled repair call when the first response is
 * not valid JSON or fails the caller's validation.
 *
 * @param {object} args
 * @param {string} args.systemPrompt
 * @param {string} args.userPrompt
 * @param {(parsed: any) => any} args.validate - returns the normalized value
 *   or throws with a human-readable reason.
 * @returns {Promise<{data: any, calls: Array<{systemPrompt: string, userPrompt: string, response: any}>}>}
 *   `calls` lists every actual LLM call made (1 or 2) for step tracing.
 */
export async function callJsonModel({ systemPrompt, userPrompt, validate }) {
  const calls = [];

  const raw = await callTextModel(systemPrompt, userPrompt);
  let parsed = extractJson(raw);
  let validationError = null;
  if (parsed !== null) {
    try {
      const data = validate ? validate(parsed) : parsed;
      calls.push({ systemPrompt, userPrompt, response: data });
      return { data, calls };
    } catch (err) {
      validationError = err.message;
    }
  }
  calls.push({ systemPrompt, userPrompt, response: { raw_response: raw } });

  // One controlled repair attempt.
  const repairSystem =
    "You repair malformed JSON. Return ONLY the corrected JSON object. No prose, no code fences.";
  const repairUser =
    `The following output should have been a single valid JSON object` +
    (validationError ? ` (problem: ${validationError})` : "") +
    `. Fix it so it is valid JSON with the same intended content:\n\n${raw}`;
  const repairedRaw = await callTextModel(repairSystem, repairUser);
  const reparsed = extractJson(repairedRaw);
  if (reparsed === null) {
    calls.push({
      systemPrompt: repairSystem,
      userPrompt: repairUser,
      response: { raw_response: repairedRaw },
    });
    throw new Error("Model returned invalid JSON even after one repair attempt.");
  }
  const data = validate ? validate(reparsed) : reparsed;
  calls.push({ systemPrompt: repairSystem, userPrompt: repairUser, response: data });
  return { data, calls };
}
