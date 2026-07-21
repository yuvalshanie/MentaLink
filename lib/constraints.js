// Deterministic hard-constraint filtering applied after Pinecone retrieval.
// Not an LLM call — never appears in the steps trace.

import { resolveDistrict, districtOfCity, canonicalCity } from "./districts";

// Constraint identifiers the UserRequestAnalyzer may emit in hardConstraints.
// Only fields the live therapist_data schema can actually verify are listed:
// language and online availability are NOT dataset columns and must never be
// used for clarification, filtering, or ranking.
export const HARD_CONSTRAINT_FIELDS = [
  "location",
  "maximumBudget",
  "therapistGenderPreference",
];

function norm(value) {
  return String(value ?? "").trim().toLowerCase();
}

// Gender values arrive in either language ("female", "אישה", "מטפלת") while
// therapist_data stores "Female"/"Male" — compare canonically.
const GENDER_SYNONYMS = Object.freeze({
  female: ["female", "woman", "women", "f", "אישה", "נקבה", "מטפלת"],
  male: ["male", "man", "men", "m", "גבר", "זכר", "מטפל"],
});

function canonicalGender(value) {
  const wanted = norm(value);
  if (wanted === "") return null;
  for (const [canonical, synonyms] of Object.entries(GENDER_SYNONYMS)) {
    if (canonical === wanted || synonyms.includes(wanted)) return canonical;
  }
  return wanted;
}

/** True when a therapist's stored gender satisfies the requested one. */
export function genderMatches(profile, wanted) {
  return (
    canonicalGender(profile?.gender) != null &&
    canonicalGender(profile?.gender) === canonicalGender(wanted)
  );
}

/**
 * True when a therapist's city satisfies the requested location, which may be
 * a city in either language ("Haifa", "חיפה") or a region ("the north",
 * "בצפון" -> any north-district city such as Haifa).
 */
export function locationMatches(profile, wanted) {
  if (profile.location == null) return false;
  const a = norm(profile.location);
  const b = norm(wanted);
  if (a === b || a.includes(b) || b.includes(a)) return true;
  // Cross-language city equality (e.g. profile "Haifa" vs request "חיפה").
  const profileCity = canonicalCity(a);
  const wantedCity = canonicalCity(b);
  if (profileCity && wantedCity) return profileCity === wantedCity;
  // Region request: match every dataset city inside that district.
  const wantedDistrict = resolveDistrict(b);
  return wantedDistrict != null && districtOfCity(a) === wantedDistrict;
}

const REQUESTED_VALUES = Object.freeze({
  location: (analysis) => analysis?.location,
  maximumBudget: (analysis) => analysis?.maximumBudget,
  therapistGenderPreference: (analysis) =>
    analysis?.therapistGenderPreference,
});

const PREFERENCE_LABELS = Object.freeze({
  location: "location",
  maximumBudget: "maximum price",
  therapistGenderPreference: "therapist gender",
});

export function getUnverifiedPreferences(analysis, availableFields = {}) {
  const requested = new Set([
    ...(analysis?.hardConstraints || []),
    ...(analysis?.softPreferences || []),
  ]);
  return HARD_CONSTRAINT_FIELDS.filter(
    (field) =>
      requested.has(field) &&
      REQUESTED_VALUES[field](analysis) != null &&
      availableFields[field] === false
  ).map((field) => ({
    field,
    label: PREFERENCE_LABELS[field],
    requestedValue: REQUESTED_VALUES[field](analysis),
    status: "unverified",
  }));
}

/**
 * Filters therapist profiles by the analysis' hard constraints.
 * A profile with a MISSING value for a hard-constrained field is excluded:
 * we cannot verify the constraint holds and must not weaken it silently.
 *
 * @param {Array<object>} profiles normalized therapist profiles
 * @param {object} analysis structured request analysis
 * @returns {{kept: Array<object>, removedCount: number}}
 */
export function applyHardConstraints(profiles, analysis, availableFields = null) {
  const hard = new Set(
    (analysis?.hardConstraints || []).filter((c) =>
      HARD_CONSTRAINT_FIELDS.includes(c)
    )
  );
  const canVerify = (field) =>
    availableFields == null || availableFields[field] !== false;

  const kept = profiles.filter((p) => {
    if (hard.has("location") && analysis.location && canVerify("location")) {
      if (!locationMatches(p, analysis.location)) return false;
    }
    if (
      hard.has("maximumBudget") &&
      analysis.maximumBudget != null &&
      canVerify("maximumBudget")
    ) {
      if (p.price == null || p.price > analysis.maximumBudget) return false;
    }
    if (
      hard.has("therapistGenderPreference") &&
      analysis.therapistGenderPreference &&
      canVerify("therapistGenderPreference")
    ) {
      if (!genderMatches(p, analysis.therapistGenderPreference)) {
        return false;
      }
    }
    return true;
  });

  return {
    kept,
    removedCount: profiles.length - kept.length,
    unverifiedPreferences: getUnverifiedPreferences(analysis, availableFields || {}),
  };
}
