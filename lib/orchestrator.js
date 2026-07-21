// Main orchestration for the MentaLink agent pipeline:
// Conversation -> deterministic pre-LLM crisis gate (lib/crisisDetection.js)
// -> UserRequestAnalyzer -> bounded clarification loop
// (max 2 rounds / 5 questions, enforced deterministically here) -> embedding
// -> agent-filtered Matchmaker knowledge + Supabase therapist_data
// -> deterministic hard filters -> MatchmakerAgent -> independently filtered
// Guardian knowledge + Supabase safety references -> EthicalGuardianAgent
// -> final response. Knowledge document IDs never enter the therapist path.
//
// Privacy: conversation content is processed transiently per request and is
// never persisted or logged by this module.

import { callEmbeddingModel, isContentPolicyError } from "./llmod";
import {
  detectCrisis,
  mentionsSelfHarmTopic,
  isEducationalDiscussion,
  detectResponseLanguage,
} from "./crisisDetection";
import { searchKnowledgeForAgent } from "./knowledgeRetrieval";
import { getTherapistData } from "./therapistRepository";
import { getGuardianReferenceData } from "./guardianRepository";
import {
  applyHardConstraints,
  locationMatches,
  genderMatches,
} from "./constraints";
import {
  parseConversationPrompt,
  renderTranscriptForModel,
  countClarificationUsage,
  buildClarificationResponse,
} from "./conversation";
import {
  runUserRequestAnalyzer,
  runMatchmakerAgent,
  runEthicalGuardianAgent,
} from "./agents";
import {
  getCrisisResources,
  KNOWLEDGE_TOP_K,
  MATCHMAKER_CANDIDATE_LIMIT,
  MAX_CLARIFICATION_ROUNDS,
  MAX_QUESTIONS_PER_ROUND,
  MAX_TOTAL_QUESTIONS,
} from "./config";
import { MODULE_MATCHMAKER, MODULE_GUARDIAN } from "./agentDataSources";

const MAX_PROMPT_LENGTH = 12000;

// Server-side crisis template — never model-generated. Content per safety
// policy: acknowledge distress, state MentaLink is not an emergency service,
// point to emergency services / a trusted person / distance from means, list
// only configured resources, no diagnosis, no promises.
function buildCrisisMessage(lang = "en") {
  const resources = getCrisisResources(lang)
    .map((r) => `- ${r}`)
    .join("\n");
  if (lang === "he") {
    return (
      "נשמע שייתכן שאת/ה במצוקה גדולה כרגע, והפנייה הזו חשובה.\n\n" +
      "MentaLink הוא כלי לאיתור מטפלים בלבד — לא שירות חירום. " +
      "אם את/ה בסכנה מיידית, פנה/י עכשיו לשירותי החירום המקומיים.\n\n" +
      "אם אפשר, פנה/י לאדם קרוב שאת/ה סומך/ת עליו ובקש/י ממנו להישאר איתך. " +
      "אם ניתן לעשות זאת בבטחה, התרחק/י מכל דבר שעלול לשמש לפגיעה עצמית.\n\n" +
      "אפשר לפנות גם אל:\n" +
      `${resources}\n\n` +
      "את/ה לא לבד. כשתרגיש/י בטוח/ה ומוכן/ה, נשמח לעזור למצוא תמיכה מקצועית מתמשכת."
    );
  }
  return (
    "It sounds like you may be in real distress right now, and reaching out matters.\n\n" +
    "MentaLink is a therapist discovery tool, not an emergency or crisis service. " +
    "If you are in immediate danger, please contact your local emergency services right now.\n\n" +
    "If you can, reach out to someone you trust — a family member, friend, or doctor — and ask them to stay with you. " +
    "If it is safe to do so, move away from anything you could use to hurt yourself.\n\n" +
    "You can also reach out to:\n" +
    `${resources}\n\n` +
    "You do not have to face this alone. When you feel safe and ready, we would be glad to help you find ongoing professional support."
  );
}

// Neutral fallback when the provider's content filter rejected the input but
// no self-harm content was detected. No provider internals, ever.
function buildFilteredInputMessage(lang = "en") {
  if (lang === "he") {
    return (
      "לא הצלחנו לעבד את ההודעה הזו באופן בטוח, ולכן לא בוצע חיפוש. " +
      "אפשר לנסות לתאר במילים אחרות מה את/ה מחפש/ת."
    );
  }
  return (
    "We were not able to process that message safely, so no search was run. " +
    "You are welcome to describe what you are looking for in different words."
  );
}

function buildNoMatchMessage(analysis, hadCandidates) {
  const constraints = analysis.hardConstraints.join(", ");
  const base = hadCandidates
    ? `We could not find a therapist matching all of your non-negotiable requirements (${constraints}). Rather than suggest someone who does not meet them, we prefer to be honest that no suitable match was found.`
    : "We could not find any therapists matching your request in our current directory.";
  return (
    base +
    " You could try relaxing one of the requirements, or check back later as new therapists join MentaLink."
  );
}

function buildDirectoryUnavailableMessage() {
  return (
    "We could not access the therapist directory right now, so we cannot safely " +
    "make therapist recommendations. Please try again later."
  );
}

function buildUnverifiedPreferenceNote(unverifiedPreferences) {
  // Generic: fires only when a supported constraint column is missing from
  // the live dataset (language/online are not analysis fields at all).
  const unavailable = [
    ...new Set(unverifiedPreferences.map((item) => item.label).filter(Boolean)),
  ];
  if (unavailable.length === 0) return "";
  const label =
    unavailable.length === 1
      ? unavailable[0]
      : `${unavailable.slice(0, -1).join(", ")} or ${unavailable.at(-1)}`;
  return `The dataset does not currently include ${label}, so these preferences could not be verified. Please confirm them directly with the therapist before booking.`;
}

function ensureUnverifiedPreferenceNote(response, unverifiedPreferences) {
  const note = buildUnverifiedPreferenceNote(unverifiedPreferences);
  if (!note) return response;
  if (/could not be verified/i.test(response) && /confirm/i.test(response)) {
    return response;
  }
  return `${response.trim()}\n\n${note}`;
}

function analysisTerms(analysis) {
  return [
    ...(analysis?.concerns || []),
    ...(analysis?.userGoals || []),
    ...(analysis?.treatmentPreferences || []),
    analysis?.therapyStylePreference,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 3);
}

function rankTherapists(profiles, analysis) {
  const terms = analysisTerms(analysis);
  return profiles
    .map((profile, index) => {
      const searchable = [
        profile.specialties?.join(" "),
        profile.treatmentApproaches?.join(" "),
        profile.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const semanticProxy = terms.reduce(
        (score, term) => score + (searchable.includes(term) ? 2 : 0),
        0
      );
      const practical =
        (analysis.location && locationMatches(profile, analysis.location)
          ? 1
          : 0) +
        (analysis.therapistGenderPreference &&
        genderMatches(profile, analysis.therapistGenderPreference)
          ? 1
          : 0);
      return {
        profile,
        index,
        rankScore: semanticProxy + practical + (profile.rating || 0) / 10,
      };
    })
    .sort((a, b) => b.rankScore - a.rankScore || a.index - b.index)
    .slice(0, MATCHMAKER_CANDIDATE_LIMIT)
    .map(({ profile, rankScore }) => ({ ...profile, score: rankScore }));
}

/**
 * Runs the full MentaLink agent pipeline.
 * @param {string} userPrompt
 * @returns {Promise<{response: string, steps: Array<object>}>}
 * @throws {Error} with a human-readable message on failure.
 */
export async function runMentaLinkAgent(userPrompt) {
  if (typeof userPrompt !== "string" || userPrompt.trim() === "") {
    throw new Error("Prompt must be a non-empty string.");
  }
  const prompt = userPrompt.trim();
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(
      `Prompt is too long (${prompt.length} characters, maximum ${MAX_PROMPT_LENGTH}).`
    );
  }

  // 1. Parse the compact conversation (plain text = single first turn).
  const { turns } = parseConversationPrompt(prompt);
  const latestUserText =
    [...turns].reverse().find((turn) => turn.role === "user")?.text ?? prompt;
  const lang = detectResponseLanguage(latestUserText);

  // 2. Deterministic pre-LLM crisis gate. Explicit self-harm content is
  //    answered from the server-side template BEFORE any LLM, embedding,
  //    Pinecone, or Supabase call: the provider's content filter may reject
  //    such text with HTTP 400, so the safe path must not depend on a model.
  if (detectCrisis(latestUserText).crisisRisk) {
    return { response: buildCrisisMessage(lang), steps: [] };
  }

  try {
    return await runPipeline({ turns, lang, latestUserText });
  } catch (error) {
    // Content-filter fallback: the provider rejected an agent call that the
    // local detector did not anticipate. Possible self-harm content routes to
    // the same crisis template; anything else gets a neutral message. Raw
    // provider errors never reach the user, and nothing is logged here.
    if (isContentPolicyError(error)) {
      const allUserText = turns
        .filter((turn) => turn.role === "user")
        .map((turn) => turn.text)
        .join("\n");
      if (mentionsSelfHarmTopic(allUserText)) {
        return { response: buildCrisisMessage(lang), steps: [] };
      }
      return { response: buildFilteredInputMessage(lang), steps: [] };
    }
    throw error;
  }
}

async function runPipeline({ turns, lang, latestUserText }) {
  const steps = [];

  // Count clarification usage so far — deterministic, not model-driven.
  const transcript = renderTranscriptForModel(turns);
  const usage = countClarificationUsage(turns);
  const clarificationLimitReached =
    usage.rounds >= MAX_CLARIFICATION_ROUNDS ||
    usage.questionsAsked >= MAX_TOTAL_QUESTIONS;

  // 2. Analyze the whole conversation (LLM) — one call handles both
  //    extraction and clarification planning.
  const { analysis, steps: analyzerSteps } =
    await runUserRequestAnalyzer(transcript);
  steps.push(...analyzerSteps);

  // 3. Crisis routing (LLM-detected): the analyzer flagged risk that the
  //    deterministic gate did not catch. The server-side template is
  //    authoritative — no Guardian LLM call is required before showing a
  //    crisis response, and the original wording is not sent back to a model.
  //    Backstop: an over-eager analyzer may flag a purely educational or
  //    research question about suicide/self-harm; the deterministic screen
  //    already cleared it and there is no self-directed phrasing, so do not
  //    show a personal-crisis response solely because the topic was named.
  if (
    (analysis.crisisRisk || analysis.action === "crisis") &&
    !isEducationalDiscussion(latestUserText)
  ) {
    return { response: buildCrisisMessage(lang), steps };
  }

  // 4. Bounded clarification: only when the analyzer asked AND the
  //    deterministic budget allows it. No embedding, retrieval, database or
  //    further LLM calls on a clarification turn.
  if (analysis.action === "ask_questions" && !clarificationLimitReached) {
    const remaining = MAX_TOTAL_QUESTIONS - usage.questionsAsked;
    const selected = analysis.questions.slice(
      0,
      Math.min(MAX_QUESTIONS_PER_ROUND, remaining)
    );
    if (selected.length > 0) {
      return {
        response: buildClarificationResponse({
          acknowledgment: analysis.acknowledgment,
          questions: selected,
          skipNote: analysis.skipNote,
        }),
        steps,
      };
    }
  }

  // 5. Query embedding (embedding model call — not an LLM chat step).
  const queryText = [
    transcript,
    ...analysis.concerns,
    ...analysis.userGoals,
    ...analysis.treatmentPreferences,
  ]
    .join("\n")
    .slice(0, 2000);
  const vector = await callEmbeddingModel(queryText);

  // 6. Retrieve Matchmaker-only/shared document knowledge. Failure is
  // non-fatal because therapist facts come from Supabase, not these chunks.
  let matchmakerKnowledge = [];
  try {
    matchmakerKnowledge = await searchKnowledgeForAgent({
      agentModule: MODULE_MATCHMAKER,
      queryEmbedding: vector,
      topK: KNOWLEDGE_TOP_K,
    });
  } catch {
    matchmakerKnowledge = [];
  }

  // 7. Fetch authoritative therapist profiles directly from therapist_data.
  // Knowledge document IDs never enter this structured-data path.
  let candidates;
  let availableFields;
  try {
    ({ profiles: candidates, availableFields } = await getTherapistData());
  } catch {
    return { response: buildDirectoryUnavailableMessage(), steps };
  }
  if (candidates.length === 0) {
    return { response: buildNoMatchMessage(analysis, false), steps };
  }

  // 8. Deterministic hard-constraint filtering (not an LLM call).
  const { kept, unverifiedPreferences } = applyHardConstraints(
    candidates,
    analysis,
    availableFields
  );

  // 9. Nothing left: explain honestly, without weakening constraints and
  //    without spending further LLM calls on an empty candidate list.
  if (kept.length === 0) {
    return {
      response: buildNoMatchMessage(analysis, candidates.length > 0),
      steps,
    };
  }

  const rankedCandidates = rankTherapists(kept, analysis);

  // 10. Rank and explain (LLM).
  const { result: matchmakerResult, steps: matchmakerSteps } =
    await runMatchmakerAgent({
      userPrompt: transcript,
      analysis,
      candidates: rankedCandidates,
      matchmakerKnowledge,
      unverifiedPreferences,
    });
  steps.push(...matchmakerSteps);

  // 11. Retrieve Guardian-only/shared knowledge and bounded structured safety
  // references independently. Either source may fail without skipping the
  // Guardian's base safety review.
  let guardianKnowledge = [];
  let guardianReferenceData = [];
  try {
    guardianKnowledge = await searchKnowledgeForAgent({
      agentModule: MODULE_GUARDIAN,
      queryEmbedding: vector,
      topK: KNOWLEDGE_TOP_K,
    });
  } catch {
    guardianKnowledge = [];
  }
  try {
    guardianReferenceData = await getGuardianReferenceData({ analysis });
  } catch {
    guardianReferenceData = [];
  }

  // 12. Ethical review (LLM) — approve, revise once, or block.
  const { review, steps: guardianSteps } = await runEthicalGuardianAgent({
    userPrompt: transcript,
    analysis,
    profiles: rankedCandidates,
    draftResponse: matchmakerResult.userMessage,
    guardianReferenceData,
    guardianKnowledge,
    unverifiedPreferences,
  });
  steps.push(...guardianSteps);

  // 13. Single decision, no revision loop: approve -> original,
  //     revise -> corrected safeResponse, block -> safety response.
  return {
    response:
      review.decision === "block"
        ? review.safeResponse
        : ensureUnverifiedPreferenceNote(
            review.safeResponse,
            unverifiedPreferences
          ),
    steps,
  };
}
