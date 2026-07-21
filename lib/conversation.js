// Centralized helper for the compact conversation representation that
// travels inside the existing /api/execute `prompt` field.
//
// Privacy: the conversation lives ONLY in the browser (React state) and in
// the transient request. Nothing here persists or logs conversation content.
//
// Envelope format (built by the frontend, parsed by the orchestrator):
//   {"mlConversation":1,"turns":[{"role":"user"|"assistant","text":"...","kind":"questions"|"final"}]}
// A plain non-JSON prompt is treated as a single first user turn.

export const CONVERSATION_VERSION = 1;

const MAX_TURNS = 12;
const MAX_TURN_CHARS = 1500;
const MAX_TRANSCRIPT_CHARS = 6000;

/** Builds the `prompt` string for /api/execute from conversation turns. */
export function buildConversationPrompt(turns) {
  if (!Array.isArray(turns) || turns.length === 0) return "";
  if (turns.length === 1 && turns[0].role === "user") {
    return turns[0].text;
  }
  return JSON.stringify({
    mlConversation: CONVERSATION_VERSION,
    turns: turns.map((t) => ({
      role: t.role,
      text: String(t.text ?? "").slice(0, MAX_TURN_CHARS),
      ...(t.kind ? { kind: t.kind } : {}),
    })),
  });
}

/**
 * Parses the `prompt` field into conversation turns.
 * Any prompt that is not a valid envelope becomes a single user turn.
 * @returns {{turns: Array<{role: string, text: string, kind?: string}>}}
 */
export function parseConversationPrompt(prompt) {
  const raw = String(prompt ?? "").trim();
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        parsed.mlConversation === CONVERSATION_VERSION &&
        Array.isArray(parsed.turns)
      ) {
        const turns = parsed.turns
          .filter(
            (t) =>
              t &&
              (t.role === "user" || t.role === "assistant") &&
              typeof t.text === "string" &&
              t.text.trim() !== ""
          )
          .slice(-MAX_TURNS)
          .map((t) => ({
            role: t.role,
            text: t.text.slice(0, MAX_TURN_CHARS),
            ...(t.kind === "questions" || t.kind === "final"
              ? { kind: t.kind }
              : {}),
          }));
        if (turns.length > 0) return { turns };
      }
    } catch {
      /* fall through: treat as plain text */
    }
  }
  return { turns: [{ role: "user", text: raw.slice(0, MAX_TURN_CHARS * 2) }] };
}

/** Renders turns as a compact transcript for LLM prompts. */
export function renderTranscriptForModel(turns) {
  const rendered = turns
    .map(
      (t) => `${t.role === "user" ? "User" : "MentaLink"}: ${t.text.trim()}`
    )
    .join("\n");
  return rendered.length > MAX_TRANSCRIPT_CHARS
    ? rendered.slice(-MAX_TRANSCRIPT_CHARS)
    : rendered;
}

/**
 * Counts numbered clarification questions ("1. ..." / "2) ...") in a text.
 * Paired with buildClarificationResponse below, which authors that format.
 */
export function countQuestions(text) {
  const matches = String(text ?? "").match(/^\s*\d+[.)]\s/gm);
  return matches ? matches.length : 0;
}

/**
 * Deterministic clarification usage so far, derived from assistant turns the
 * frontend marked as clarification ("questions") turns.
 * @returns {{rounds: number, questionsAsked: number}}
 */
export function countClarificationUsage(turns) {
  const questionTurns = turns.filter(
    (t) => t.role === "assistant" && t.kind === "questions"
  );
  return {
    rounds: questionTurns.length,
    questionsAsked: questionTurns.reduce(
      (sum, t) => sum + countQuestions(t.text),
      0
    ),
  };
}

/**
 * Composes the clarification response text: acknowledgment, numbered
 * questions, and a skip note — all model-generated in the user's language,
 * with plain fallbacks.
 */
export function buildClarificationResponse({ acknowledgment, questions, skipNote }) {
  const ack =
    acknowledgment && acknowledgment.trim() !== ""
      ? acknowledgment.trim()
      : "Thank you for sharing that. A couple of short questions will help narrow the options:";
  const note =
    skipNote && skipNote.trim() !== ""
      ? skipNote.trim()
      : "You can skip any question you'd rather not answer.";
  const numbered = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  return `${ack}\n\n${numbered}\n\n${note}`;
}
