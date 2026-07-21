// Shared helpers for mocking LLMod (via global fetch) and building fixtures.
// Mocks exist ONLY in tests — production code never uses mock data.

import { vi } from "vitest";

export function okJson(json) {
  return { ok: true, status: 200, json: async () => json };
}

export function chatResponse(content) {
  return okJson({
    choices: [
      {
        message: {
          content: typeof content === "string" ? content : JSON.stringify(content),
        },
      },
    ],
  });
}

/**
 * Installs a global fetch mock that dispatches LLMod calls by system prompt.
 * handlers: { embedding?: number[], analyzer, matchmaker, guardian, repair }
 * Each agent handler is an object/string, or an array used as a FIFO queue.
 * Returns { fetchMock, chatCalls } where chatCalls collects request bodies
 * with a `agent` tag, in chronological order.
 */
export function installFetchMock(handlers) {
  const chatCalls = [];
  const queues = { ...handlers };
  const next = (key) => {
    const v = queues[key];
    return Array.isArray(v) ? v.shift() : v;
  };
  const fetchMock = vi.fn(async (url, init) => {
    if (String(url).includes("/embeddings")) {
      return okJson({ data: [{ embedding: handlers.embedding ?? [0.1, 0.2, 0.3] }] });
    }
    const body = JSON.parse(init.body);
    const sys = body.messages[0].content;
    let agent;
    if (sys.startsWith("You analyze")) agent = "analyzer";
    else if (sys.startsWith("You rank")) agent = "matchmaker";
    else if (sys.startsWith("You are an ethical")) agent = "guardian";
    else if (sys.startsWith("You repair")) agent = "repair";
    else throw new Error(`Unexpected system prompt: ${sys.slice(0, 60)}`);
    chatCalls.push({ agent, body });
    const value = next(agent);
    if (value === undefined) {
      throw new Error(`No mock response configured for ${agent}`);
    }
    return chatResponse(value);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, chatCalls };
}

export function analysisFixture(overrides = {}) {
  return {
    concerns: ["feeling anxious"],
    location: null,
    maximumBudget: null,
    therapistGenderPreference: null,
    treatmentPreferences: [],
    hardConstraints: [],
    softPreferences: [],
    crisisRisk: false,
    missingImportantInformation: [],
    ...overrides,
  };
}

/** Builds one raw Pinecone match: id + similarity score only. */
export function pineconeHit(id, score = 0.9) {
  return { id, score };
}

/** Builds one raw Supabase therapist row (full structured profile). */
export function supabaseRow(id, overrides = {}) {
  return {
    id,
    name: `Therapist ${id}`,
    location: "Haifa",
    price: 250,
    languages: ["Hebrew", "English"],
    gender: "female",
    online: true,
    specialties: ["anxiety"],
    treatmentApproaches: ["CBT"],
    description: "Licensed therapist.",
    ...overrides,
  };
}

export function matchmakerFixture(ids, userMessage = "Here are therapists that may be worth considering.") {
  return {
    recommendations: ids.map((id) => ({
      id,
      whyRelevant: "Profile focus areas may match the expressed concerns.",
      matchedPreferences: ["budget"],
      limitations: [],
      summary: "May be worth considering.",
    })),
    userMessage,
  };
}

export function guardianFixture(decision, safeResponse, issues = []) {
  return { decision, issues, safeResponse };
}
