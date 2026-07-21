// Deterministic, server-side crisis detection that runs BEFORE any LLM,
// embedding, Pinecone, or Supabase call. The provider's content filter can
// reject explicit self-harm text with HTTP 400, so crisis safety must never
// depend on a model successfully processing the message.
//
// All crisis keywords/phrases live in this module only.
// Privacy: callers must never log or persist the inspected message; this
// module returns only structured flags, never the original text.

function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// Self-directed, explicit high-risk expressions. Matching ANY of these is a
// crisis regardless of surrounding context — recall is prioritized here.
const SELF_DIRECTED_PATTERNS = [
  // English — wanting to die / kill oneself
  /\b(?:kill|killing|hurt|hurting|harm|harming|cut|cutting)\s+myself\b/,
  /\bend(?:ing)?\s+my\s+(?:own\s+)?life\b/,
  /\bend\s+it\s+all\b/,
  /\b(?:take|taking|took)\s+my\s+(?:own\s+)?life\b/,
  /\b(?:want|wants|wanted|wanting|wish|wishing|going|ready|plan(?:ning)?)\s+to\s+die\b/,
  /\bdon'?t\s+want\s+to\s+(?:live|be\s+alive)\b/,
  /\b(?:i\s+would\s+be|i'?d\s+be|i\s+am|i'?m)\s+better\s+off\s+dead\b/,
  /\bbetter\s+off\s+dead\b/,
  /\bno\s+(?:reason|point)\s+(?:left\s+)?(?:to\s+live|in\s+living)\b/,
  /\b(?:i\s+)?(?:want|plan(?:ning)?|going|intend(?:ing)?)\s+to\s+commit\s+suicide\b/,
  /\b(?:i\s+am|i'?m|i\s+feel|feel(?:ing)?)\s+suicidal\b/,
  /\b(?:having|have\s+been\s+having|i'?ve\s+been\s+having)\s+suicidal\s+thoughts\b/,
  // English — immediate plan / cannot stay safe
  /\bcan'?t\s+(?:keep|stay)\s+(?:myself\s+)?safe\b/,
  /\bnot\s+(?:able\s+to\s+)?(?:stay|keep)\s+safe\s+from\s+myself\b/,
  /\bhave\s+a\s+plan\s+to\s+(?:die|kill|end)\b/,
  // Hebrew — wanting to die / kill oneself
  /להתאבד/,
  /אתאבד/,
  /לשים\s+קץ\s+לחיי/,
  /לשים\s+קץ\s+לחיים\s+שלי/,
  /רוצה\s+למות/,
  /בא\s+לי\s+למות/,
  /לא\s+רוצה\s+לחיות/,
  /(?:לפגוע|אפגע|פוגעת?)\s+בעצמי/,
  /לחתוך\s+את\s+עצמי/,
  /אין\s+(?:לי\s+)?(?:טעם|סיבה)\s+לחיות/,
  /עדיף\s+שאמות/,
  /הלוואי\s+שאמות/,
  /מחשבות\s+אובדניות/,
  /אובדני/,
  // Hebrew — cannot stay safe
  /לא\s+(?:יכול|יכולה)\s+לשמור\s+על\s+עצמי/,
];

// Generic suicide/self-harm topic mentions. Crisis only when NOT clearly an
// educational / research / third-person discussion.
const GENERIC_TOPIC_PATTERNS = [
  /\bsuicide\b/,
  /\bself[- ]harm\b/,
  /התאבדות/,
  /פגיעה\s+עצמית/,
];

// Markers of educational / professional / third-person discussion.
const EDUCATIONAL_CONTEXT_PATTERNS = [
  /\b(?:research(?:ing)?|writing|wrote|write|essay|paper|article|thesis|report|homework|assignment|studying|study(?:ing)?|course|class|lecture|training|documentary|statistics|awareness|prevention|policy|guidelines?)\b/,
  /\bhow\s+(?:do|would|should|to)\b/,
  /\bmy\s+(?:friend|brother|sister|son|daughter|mother|father|partner|colleague|student|patient|client)\b/,
  /מניעת/,
  /מחקר/,
  /כתבה/,
  /מאמר/,
  /עבודה\s+(?:סמינריונית|אקדמית)/,
  /לומדת?/,
  /הרצאה/,
  /שאלה\s+(?:אקדמית|מקצועית|תאורטית|תיאורטית)/,
];

/**
 * Deterministic crisis screen for one user message.
 * @param {string} text the user's latest message (never logged or persisted)
 * @returns {{crisisRisk: boolean, level: "high"|"none", reason: string}}
 */
export function detectCrisis(text) {
  const normalized = normalize(text);
  if (normalized === "") {
    return { crisisRisk: false, level: "none", reason: "empty_message" };
  }
  if (SELF_DIRECTED_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      crisisRisk: true,
      level: "high",
      reason: "explicit_self_harm_intent",
    };
  }
  if (GENERIC_TOPIC_PATTERNS.some((pattern) => pattern.test(normalized))) {
    const educational = EDUCATIONAL_CONTEXT_PATTERNS.some((pattern) =>
      pattern.test(normalized)
    );
    if (!educational) {
      return {
        crisisRisk: true,
        level: "high",
        reason: "explicit_suicide_reference",
      };
    }
  }
  return { crisisRisk: false, level: "none", reason: "no_crisis_indicators" };
}

/**
 * True when the message discusses suicide/self-harm as a topic in a clearly
 * educational, research, professional, or third-person frame AND contains no
 * self-directed crisis phrasing. Used as a deterministic backstop so an
 * over-eager analyzer LLM cannot force a personal-crisis response onto an
 * academic question just because the word "suicide" appears.
 */
export function isEducationalDiscussion(text) {
  const normalized = normalize(text);
  if (normalized === "") return false;
  // Anyone stating their own explicit intent is never "just educational".
  if (SELF_DIRECTED_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  const mentionsTopic = GENERIC_TOPIC_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  );
  const educational = EDUCATIONAL_CONTEXT_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  );
  return mentionsTopic && educational;
}

/**
 * Looser recall-first screen used ONLY when the provider's content filter has
 * already rejected the input: decides whether the fallback should be the
 * crisis template (possible self-harm content) or a neutral safety message.
 */
export function mentionsSelfHarmTopic(text) {
  const normalized = normalize(text);
  if (normalized === "") return false;
  if (detectCrisis(normalized).crisisRisk) return true;
  return (
    GENERIC_TOPIC_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    /\b(?:die|dying|dead|death|overdose|jump\s+off|no\s+way\s+out)\b/.test(
      normalized
    ) ||
    /למות|מוות|קץ\s+לחיי/.test(normalized)
  );
}

/** Deterministic response-language pick: Hebrew characters -> Hebrew. */
export function detectResponseLanguage(text) {
  return /[֐-׿]/.test(String(text ?? "")) ? "he" : "en";
}
