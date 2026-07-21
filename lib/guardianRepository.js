// Bounded, server-side reference access for EthicalGuardianAgent.
// Patient identifiers and unnecessary demographic fields are never returned.

import { getSupabase } from "./supabase";
import { getAgentDataSource, MODULE_GUARDIAN } from "./agentDataSources";
import {
  GUARDIAN_REFERENCE_LIMIT,
  GUARDIAN_REFERENCE_SCAN_LIMIT,
} from "./config";

const TABLE =
  process.env.SUPABASE_GUARDIAN_TABLE ||
  getAgentDataSource(MODULE_GUARDIAN).defaultSupabaseTable;

const COLUMN_MAP = Object.freeze({
  diagnosis: "Diagnosis",
  symptomSeverity: "Symptom Severity (1-10)",
  moodScore: "Mood Score (1-10)",
  sleepQuality: "Sleep Quality (1-10)",
  physicalActivity: "Physical Activity (hrs/week)",
  medication: "Medication",
  therapyType: "Therapy Type",
  treatmentDurationWeeks: "Treatment Duration (weeks)",
  stressLevel: "Stress Level (1-10)",
  outcome: "Outcome",
  treatmentProgress: "Treatment Progress (1-10)",
  emotionalState: "AI-Detected Emotional State",
  adherencePercent: "Adherence to Treatment (%)",
});

function valueOrNull(value) {
  return value == null || value === "" ? null : value;
}

export function normalizeGuardianReference(row) {
  if (!row) return null;
  return Object.fromEntries(
    Object.entries(COLUMN_MAP).map(([normalized, source]) => [
      normalized,
      valueOrNull(row[source]),
    ])
  );
}

function tokensFromAnalysis(analysis) {
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
    .filter((token) => token.length >= 3);
}

function referenceScore(reference, tokens) {
  if (tokens.length === 0) return 0;
  const haystack = Object.values(reference).filter(Boolean).join(" ").toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

export async function getGuardianReferenceData({
  analysis,
  limit = GUARDIAN_REFERENCE_LIMIT,
} = {}) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || GUARDIAN_REFERENCE_LIMIT, 12));
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("*")
    .limit(GUARDIAN_REFERENCE_SCAN_LIMIT);

  if (error) {
    throw new Error(`Guardian reference lookup failed: ${error.message}`);
  }

  const tokens = tokensFromAnalysis(analysis);
  return (data || [])
    .map((row) => normalizeGuardianReference(row))
    .filter(Boolean)
    .map((reference, index) => ({
      reference,
      index,
      score: referenceScore(reference, tokens),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, boundedLimit)
    .map(({ reference }) => reference);
}

export const GUARDIAN_TABLE = TABLE;
