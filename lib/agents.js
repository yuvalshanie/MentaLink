// The three LLM agents of the MentaLink pipeline.
// Module names are shared, exact identifiers used in code, /api/agent_info,
// /api/execute steps, and the architecture diagram:
//   UserRequestAnalyzer, MatchmakerAgent, EthicalGuardianAgent

import { callJsonModel } from "./llmod";
import { HARD_CONSTRAINT_FIELDS } from "./constraints";
import { MAX_RECOMMENDATIONS, MAX_QUESTIONS_PER_ROUND } from "./config";
import {
  MODULE_ANALYZER,
  MODULE_MATCHMAKER,
  MODULE_GUARDIAN,
} from "./agentDataSources";

export { MODULE_ANALYZER, MODULE_MATCHMAKER, MODULE_GUARDIAN };

// Step shape matches the course document exactly:
// { module, prompt: { System_prompt, User_prompt }, response }
function callsToSteps(moduleName, calls) {
  return calls.map((c) => ({
    module: moduleName,
    prompt: { System_prompt: c.systemPrompt, User_prompt: c.userPrompt },
    response: c.response,
  }));
}

// ---------------------------------------------------------------------------
// UserRequestAnalyzer
// ---------------------------------------------------------------------------

const ANALYZER_SYSTEM_PROMPT = `You analyze a short conversation between MentaLink (a therapist-discovery assistant) and a person seeking a therapist. Use the WHOLE conversation, not only the last message. Return ONLY a JSON object:
{"action":"ask_questions|search|crisis","informationSufficient":false,"concerns":[],"userGoals":[],"location":null,"maximumBudget":null,"therapistGenderPreference":null,"therapyStylePreference":null,"treatmentPreferences":[],"hardConstraints":[],"softPreferences":[],"missingHighImpactInformation":[],"questions":[],"acknowledgment":"","skipNote":"","crisisRisk":false}
The therapist directory contains ONLY: name, city, neighborhood, price per session, therapist gender, therapy type, and rating. It has NO information about session language or online/remote availability, so those details can never affect matching. NEVER ask about language, online sessions, in-person sessions, or session format, and never extract them as preferences.
Extraction rules:
- concerns: the user's struggles in their own everyday words. userGoals: what they hope will improve. NEVER diagnose or convert symptoms into medical conditions.
- location: the city, area, or region EXACTLY as the user stated it (e.g. "Haifa", "the north", "המרכז") or null — regions are valid values, never convert a region into a specific city. maximumBudget: number or null. therapistGenderPreference: "female", "male", or null — always output the English word even when the user wrote it in another language (e.g. "מטפלת" -> "female"). therapyStylePreference: plain-language description (e.g. "structured and practical", "open conversational", "short-term focused") or null.
- treatmentPreferences: approaches the user explicitly mentioned.
- hardConstraints: subset of [${HARD_CONSTRAINT_FIELDS.map((f) => `"${f}"`).join(",")}] the user explicitly stated as non-negotiable. Words such as "must", "only", "required", and "cannot exceed" indicate hard constraints. A stated upper limit such as "up to 350 NIS" makes maximumBudget hard. softPreferences: the same identifiers for flexible wishes. Words such as "prefer", "would feel more comfortable", "ideally", and "if possible" indicate soft preferences. Default to softPreferences when unclear, and never put one field in both arrays.
- crisisRisk: true ONLY when the person expresses their OWN immediate danger, self-harm, or suicide risk (e.g. wanting to die, a plan or intent, being unable to stay safe). Do NOT set crisisRisk for educational, academic, research, professional, or third-person discussion of suicide/self-harm, nor for a general mention of a past struggle, a diagnosis like PTSD or depression, or an interest in "suicide prevention" — naming the topic is not the same as personal risk. When crisisRisk is true, action MUST be "crisis" and questions MUST be empty.
Clarification rules:
- action "search" when the conversation already covers the main reason for seeking help plus enough practical detail (roughly: city/area, and budget or gender when they matter) OR the user declined/answered previous questions ("no preference", "not sure", "skip" count as answered). Never re-ask anything already answered or declined.
- action "ask_questions" only when 1-3 missing items would MATERIALLY improve matching. List them in missingHighImpactInformation and write the questions (max ${MAX_QUESTIONS_PER_ROUND}, fewer is better; prefer resolving everything in one round). Priority: 1) main reason + hoped improvement, 2) preferred city, area, or region (a region like "the north" or "המרכז" is a complete answer), 3) maximum budget per session, 4) therapist gender if relevant, 5) therapy style in plain words (structured/practical vs open conversational vs short-term focused vs no preference). Ask ONLY about these; never ask a question whose answer the directory cannot use.
- Questions must be compassionate, concise, plain-language, in the user's own language, never pressuring, never diagnostic. Always allow "not sure", "no preference", or "prefer not to say". Never ask for name, ID, address, phone, email, other identifying details, trauma details, or a diagnosis.
- acknowledgment: 1 warm short sentence in the user's language introducing the questions. skipNote: 1 short sentence in the user's language saying they may skip any question. Both empty when action is "search".
- Use null / empty arrays for anything not provided. No extra keys, no prose.`;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nearbyHardCue(text, terms) {
  const cue = "(?:must|only|required|non-negotiable|cannot)";
  return terms.filter(Boolean).some((term) => {
    const escaped = escapeRegExp(term);
    return (
      new RegExp(`${cue}[^.!?\\n]{0,50}\\b${escaped}\\b`, "i").test(text) ||
      new RegExp(`\\b${escaped}\\b[^.!?\\n]{0,50}${cue}`, "i").test(text)
    );
  });
}

function reconcileConstraintIntent(analysis, userPrompt) {
  const text = String(userPrompt || "");
  const parsedHard = new Set(analysis.hardConstraints);
  const parsedSoft = new Set(analysis.softPreferences);
  const specified = {
    location: analysis.location,
    maximumBudget: analysis.maximumBudget,
    therapistGenderPreference: analysis.therapistGenderPreference,
  };
  const hasSoftCue =
    /\b(prefer|preferably|ideally|if possible|would feel (?:more )?comfortable)\b/i.test(
      text
    );
  const explicitHard = new Set();

  if (
    analysis.maximumBudget != null &&
    (/\b(up to|no more than|at most|cannot exceed|maximum|max(?:imum)? budget)\b/i.test(
      text
    ) ||
      nearbyHardCue(text, ["budget", "price", "NIS", "session"]))
  ) {
    explicitHard.add("maximumBudget");
  }
  if (nearbyHardCue(text, [analysis.location])) explicitHard.add("location");
  if (
    nearbyHardCue(text, [
      analysis.therapistGenderPreference,
      "female",
      "male",
      "gender",
    ])
  ) {
    explicitHard.add("therapistGenderPreference");
  }

  for (const field of HARD_CONSTRAINT_FIELDS) {
    if (specified[field] == null) {
      parsedHard.delete(field);
      parsedSoft.delete(field);
      continue;
    }
    if (explicitHard.has(field)) {
      parsedHard.add(field);
      parsedSoft.delete(field);
    } else if (hasSoftCue) {
      parsedHard.delete(field);
      parsedSoft.add(field);
    } else if (!parsedHard.has(field) && !parsedSoft.has(field)) {
      parsedSoft.add(field);
    }
  }

  // An explicit budget ceiling stays hard even when "prefer" appears earlier.
  for (const field of explicitHard) {
    parsedHard.add(field);
    parsedSoft.delete(field);
  }
  return {
    hardConstraints: [...parsedHard],
    softPreferences: [...parsedSoft],
  };
}

// Deterministic guard: the therapist dataset has no language or online/remote
// columns, so questions about them can never affect matching and must never
// reach the user — regardless of what the model produced. English + Hebrew.
const UNSUPPORTED_QUESTION_PATTERN =
  /\bonline\b|\bin[- ]person\b|\bremote(?:ly)?\b|\bvirtual(?:ly)?\b|\bvideo\b|\bzoom\b|\blanguage\b|\b[a-z]+[- ]speaking\b|אונליין|מקוון|מרחוק|וידאו|זום|פרונטלי|שפה|דובר/i;

export function isUnsupportedQuestion(text) {
  return UNSUPPORTED_QUESTION_PATTERN.test(String(text ?? ""));
}

function validateAnalysis(parsed, userPrompt = "") {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("analysis must be a JSON object");
  }
  const arr = (v) => (Array.isArray(v) ? v.map(String) : []);
  const strOrNull = (v) =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  const numOrNull = (v) => {
    const n = Number(v);
    return v != null && Number.isFinite(n) ? n : null;
  };
  const constraintIds = (v) =>
    arr(v).filter((c) => HARD_CONSTRAINT_FIELDS.includes(c));

  const crisisRisk = parsed.crisisRisk === true;
  const questions = arr(parsed.questions)
    .map((q) => q.trim())
    .filter((q) => q !== "" && !isUnsupportedQuestion(q));
  let action = String(parsed.action ?? "").toLowerCase();
  if (crisisRisk) {
    action = "crisis";
  } else if (!["ask_questions", "search", "crisis"].includes(action)) {
    action = questions.length > 0 ? "ask_questions" : "search";
  }
  if (action === "ask_questions" && questions.length === 0) action = "search";

  const analysis = {
    action,
    informationSufficient: parsed.informationSufficient === true,
    concerns: arr(parsed.concerns),
    userGoals: arr(parsed.userGoals),
    location: strOrNull(parsed.location),
    maximumBudget: numOrNull(parsed.maximumBudget),
    therapistGenderPreference: strOrNull(parsed.therapistGenderPreference),
    therapyStylePreference: strOrNull(parsed.therapyStylePreference),
    treatmentPreferences: arr(parsed.treatmentPreferences),
    hardConstraints: constraintIds(parsed.hardConstraints),
    softPreferences: constraintIds(parsed.softPreferences),
    missingHighImpactInformation: arr(parsed.missingHighImpactInformation).filter(
      (item) => !isUnsupportedQuestion(item)
    ),
    questions,
    acknowledgment: strOrNull(parsed.acknowledgment) ?? "",
    skipNote: strOrNull(parsed.skipNote) ?? "",
    crisisRisk,
  };
  return { ...analysis, ...reconcileConstraintIntent(analysis, userPrompt) };
}

/**
 * @param {string} userPrompt
 * @returns {Promise<{analysis: object, steps: Array<object>}>}
 */
export async function runUserRequestAnalyzer(userPrompt) {
  const { data, calls } = await callJsonModel({
    systemPrompt: ANALYZER_SYSTEM_PROMPT,
    userPrompt,
    validate: (parsed) => validateAnalysis(parsed, userPrompt),
  });
  return { analysis: data, steps: callsToSteps(MODULE_ANALYZER, calls) };
}

// ---------------------------------------------------------------------------
// MatchmakerAgent
// ---------------------------------------------------------------------------

const MATCHMAKER_SYSTEM_PROMPT = `You rank therapist candidates for a person seeking support. therapist_candidates is the ONLY source of therapist-specific facts. matchmaker_knowledge contains general supporting knowledge about therapy and may help reasoning or explanation, but it is not a therapist directory and must never be treated as therapist profiles. Retrieved knowledge may be irrelevant; ignore it when it is not useful. Never invent experience, qualifications, prices, locations, specialties, language, online availability, or treatment methods. Missing therapist details must remain unknown. unverified_preferences lists requested details that the therapist dataset cannot verify: do not claim they matched, identify them as unverified limitations, and tell the user to confirm them directly before booking. Never diagnose the user. Never guarantee suitability or treatment success; use careful wording like "may be relevant" or "could be worth considering". You may suggest treatment approaches the user could discuss with a qualified professional, but never state a treatment is medically required.
Return ONLY a JSON object:
{"recommendations":[{"id":"<candidate id>","whyRelevant":"...","matchedPreferences":["..."],"limitations":["..."],"summary":"one short plain-language sentence"}],"userMessage":"..."}
Rules:
- At most ${MAX_RECOMMENDATIONS} recommendations, best first, id must be a given candidate id.
- whyRelevant: why this therapist may fit the user's expressed needs, grounded in candidate fields. matchedPreferences: which practical preferences matched (budget, location, gender, approach). limitations: possible mismatches or missing info. The dataset contains no language or online-availability information: never discuss language or online/in-person availability in the reply, not even as a limitation or unverified detail.
- userMessage: the full plain-language reply for the user, in accessible everyday language (no clinical jargon). Structure: brief empathetic acknowledgment of what the user shared; optionally one possible therapy direction they could discuss with a professional (never presented as required); for each recommended therapist the name and relevant available profile details, why they may fit, what matched, and possible limitations; end with one short disclaimer that MentaLink only helps find potentially relevant options and does not diagnose or replace professional care. If fewer than ${MAX_RECOMMENDATIONS} candidates are suitable, say why. No diagnosis, no guarantees, no invented details.`;

function makeMatchmakerValidator(candidates) {
  const byId = new Map(candidates.map((c) => [String(c.id), c]));
  return (parsed) => {
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("matchmaker output must be a JSON object");
    }
    if (typeof parsed.userMessage !== "string" || parsed.userMessage.trim() === "") {
      throw new Error("matchmaker output must include a non-empty userMessage");
    }
    const recs = Array.isArray(parsed.recommendations)
      ? parsed.recommendations
      : [];
    // Drop any recommendation that does not reference a real retrieved
    // candidate — prevents invented therapists deterministically.
    const grounded = recs
      .filter((r) => r && byId.has(String(r.id)))
      .slice(0, MAX_RECOMMENDATIONS)
      .map((r) => {
        const profile = byId.get(String(r.id));
        return {
          id: String(r.id),
          name: profile.name,
          profile,
          whyRelevant: String(r.whyRelevant ?? ""),
          matchedPreferences: Array.isArray(r.matchedPreferences)
            ? r.matchedPreferences.map(String)
            : [],
          limitations: Array.isArray(r.limitations)
            ? r.limitations.map(String)
            : [],
          summary: String(r.summary ?? ""),
        };
      });
    return {
      recommendations: grounded,
      userMessage: parsed.userMessage.trim(),
    };
  };
}

/**
 * @param {object} args
 * @param {string} args.userPrompt
 * @param {object} args.analysis
 * @param {Array<object>} args.candidates normalized therapist profiles
 * @returns {Promise<{result: object, steps: Array<object>}>}
 */
export async function runMatchmakerAgent({
  userPrompt,
  analysis,
  candidates,
  matchmakerKnowledge = [],
  unverifiedPreferences = [],
}) {
  const candidateData = candidates.map(({ score, ...profile }) => profile);
  const matchmakerUserPrompt = JSON.stringify({
    user_request: userPrompt,
    analysis,
    therapist_candidates: candidateData,
    unverified_preferences: unverifiedPreferences,
    matchmaker_knowledge: matchmakerKnowledge.map((chunk) => ({
      text: chunk.text,
      source_file: chunk.sourceFile,
      score: chunk.score,
    })),
  });
  const { data, calls } = await callJsonModel({
    systemPrompt: MATCHMAKER_SYSTEM_PROMPT,
    userPrompt: matchmakerUserPrompt,
    validate: makeMatchmakerValidator(candidates),
  });
  return { result: data, steps: callsToSteps(MODULE_MATCHMAKER, calls) };
}

// ---------------------------------------------------------------------------
// EthicalGuardianAgent
// ---------------------------------------------------------------------------

const GUARDIAN_SYSTEM_PROMPT = `You are an ethical reviewer for a therapist-matching assistant. therapist_profiles is the only source of therapist-specific facts. guardian_reference_data and guardian_knowledge are safety references only: they may be irrelevant, must not be treated as therapist profiles, and do not permit you to diagnose the user. unverified_preferences lists requested details unavailable in the therapist dataset. Ensure the response never claims those details matched and clearly asks the user to confirm them directly before booking. Review the draft response for: definitive or implied diagnosis; unsupported diagnosis or treatment claims; invented therapist details (the dataset has NO language or online-availability information, so any claim about them is invented — remove such claims rather than flag them as unverified); recommendations of any therapist absent from therapist_profiles; guaranteed outcomes; contraindications or limitations supported by the references; insensitive or stigmatizing language; privacy concerns; manipulation or pressure; violations of the user's hard constraints; unsafe handling of crisis content; misleading claims about the system's capabilities. Revise or block when needed, and never produce a definitive diagnosis.
Return ONLY a JSON object: {"decision":"approve|revise|block","issues":[],"safeResponse":"..."}
- approve: the draft contains none of the listed problems; safeResponse repeats it unchanged. Approving is the CORRECT outcome for a grounded, careful draft — do NOT revise for tone, style, phrasing preferences, or hypothetical improvements. Mentioning available dataset facts (therapy type, price, rating, review count) with cautious wording is safe and must not trigger a revision.
- revise: one of the listed problems is actually present; safeResponse is the single corrected reply (keep grounded content, remove/repair only what is problematic).
- block: the draft is unsafe to send; safeResponse is a safety-focused reply without therapist recommendations.
- issues: short descriptions of each problem found (empty when approving).`;

function validateGuardian(parsed) {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("guardian output must be a JSON object");
  }
  const decision = String(parsed.decision ?? "").toLowerCase();
  if (!["approve", "revise", "block"].includes(decision)) {
    throw new Error('guardian decision must be "approve", "revise", or "block"');
  }
  if (
    typeof parsed.safeResponse !== "string" ||
    parsed.safeResponse.trim() === ""
  ) {
    throw new Error("guardian output must include a non-empty safeResponse");
  }
  return {
    decision,
    issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
    safeResponse: parsed.safeResponse.trim(),
  };
}

/**
 * @param {object} args
 * @param {string} args.userPrompt
 * @param {object} args.analysis
 * @param {Array<object>} args.profiles therapist profiles used in the draft
 * @param {string} args.draftResponse
 * @returns {Promise<{review: object, steps: Array<object>}>}
 */
export async function runEthicalGuardianAgent({
  userPrompt,
  analysis,
  profiles,
  draftResponse,
  guardianReferenceData = [],
  guardianKnowledge = [],
  unverifiedPreferences = [],
}) {
  const guardianUserPrompt = JSON.stringify({
    user_request: userPrompt,
    analysis,
    therapist_profiles: profiles.map(({ score, ...profile }) => profile),
    draft_response: draftResponse,
    unverified_preferences: unverifiedPreferences,
    guardian_reference_data: guardianReferenceData,
    guardian_knowledge: guardianKnowledge.map((chunk) => ({
      text: chunk.text,
      source_file: chunk.sourceFile,
      score: chunk.score,
    })),
  });
  const { data, calls } = await callJsonModel({
    systemPrompt: GUARDIAN_SYSTEM_PROMPT,
    userPrompt: guardianUserPrompt,
    validate: validateGuardian,
  });
  // "approve" must return the original draft untouched — enforce it
  // deterministically rather than trusting the model's copy.
  const review =
    data.decision === "approve" ? { ...data, safeResponse: draftResponse } : data;
  return { review, steps: callsToSteps(MODULE_GUARDIAN, calls) };
}
