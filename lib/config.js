// Central configuration for the MentaLink agent.

// Crisis resources shown in the safety-focused response.
// Deliberately generic by default: the system must never invent emergency
// phone numbers. Deployments can configure real, verified local resources
// via the CRISIS_RESOURCES environment variable (JSON array of strings),
// e.g. CRISIS_RESOURCES='["Emergency services: 101", "ERAN hotline: 1201"]'
// An optional CRISIS_RESOURCES_HE overrides the list for Hebrew responses.
function parseResourceList(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function getCrisisResources(lang = "en") {
  if (lang === "he") {
    const hebrew =
      parseResourceList(process.env.CRISIS_RESOURCES_HE) ||
      parseResourceList(process.env.CRISIS_RESOURCES);
    if (hebrew) return hebrew;
    return [
      "שירותי החירום המקומיים שלך",
      "קו סיוע או מוקד תמיכה נפשית מקומי",
      "אדם קרוב שאפשר לסמוך עליו — בן משפחה, חבר או רופא",
    ];
  }
  const configured = parseResourceList(process.env.CRISIS_RESOURCES);
  if (configured) return configured;
  return [
    "Your local emergency services",
    "A local crisis or mental-health helpline",
    "A trusted person near you — a family member, friend, or doctor",
  ];
}

// Legacy therapist-vector retrieval setting (kept for the separate adapter).
export const RETRIEVAL_TOP_K = Number(process.env.RETRIEVAL_TOP_K || 10);

// Bounded agent-knowledge and structured-data context.
export const KNOWLEDGE_TOP_K = Number(process.env.KNOWLEDGE_TOP_K || 8);
export const MAX_KNOWLEDGE_CHARS = Number(
  process.env.MAX_KNOWLEDGE_CHARS || 6000
);
export const MAX_KNOWLEDGE_CHUNK_CHARS = Number(
  process.env.MAX_KNOWLEDGE_CHUNK_CHARS || 1800
);
// Chunks shorter than this carry no usable knowledge (audit found e.g. a
// 14-character fragment) and would waste a topK slot.
export const MIN_KNOWLEDGE_CHUNK_CHARS = Number(
  process.env.MIN_KNOWLEDGE_CHUNK_CHARS || 40
);
export const THERAPIST_SCAN_LIMIT = Number(
  process.env.THERAPIST_SCAN_LIMIT || 50
);
export const MATCHMAKER_CANDIDATE_LIMIT = Number(
  process.env.MATCHMAKER_CANDIDATE_LIMIT || 10
);
export const GUARDIAN_REFERENCE_SCAN_LIMIT = Number(
  process.env.GUARDIAN_REFERENCE_SCAN_LIMIT || 40
);
export const GUARDIAN_REFERENCE_LIMIT = Number(
  process.env.GUARDIAN_REFERENCE_LIMIT || 6
);

// Maximum number of recommendations returned to the user.
export const MAX_RECOMMENDATIONS = 3;

// Clarification limits — enforced deterministically in the orchestrator.
export const MAX_CLARIFICATION_ROUNDS = 2;
export const MAX_QUESTIONS_PER_ROUND = 3;
export const MAX_TOTAL_QUESTIONS = 5;
