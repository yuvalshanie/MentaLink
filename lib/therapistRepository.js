// Structured therapist repository. Supabase therapist_data is the source of
// truth for therapist-specific facts. Pinecone knowledge-document IDs must
// never be sent to this module.

import { getSupabase } from "./supabase";
import { getAgentDataSource, MODULE_MATCHMAKER } from "./agentDataSources";
import { THERAPIST_SCAN_LIMIT } from "./config";

const TABLE =
  process.env.SUPABASE_THERAPIST_TABLE ||
  getAgentDataSource(MODULE_MATCHMAKER).defaultSupabaseTable;

// All schema-specific names live here. The first alias for each field is the
// verified live therapist_data column; later aliases preserve compatibility
// with earlier/local datasets without inventing absent values.
const COLUMN_MAP = Object.freeze({
  id: ["therapist_id", "id", "therapistId", "ID"],
  name: ["name", "therapist_name", "therapistName", "Name"],
  location: ["city", "location", "Location", "City"],
  neighborhood: ["neighborhood", "Neighborhood"],
  price: ["price_nis", "price", "session_price", "price_per_session", "Price"],
  gender: ["gender", "Gender"],
  specialties: ["specialties", "specialty", "Specialties", "Specialty"],
  treatmentApproaches: [
    "treatmentApproaches",
    "treatment_approaches",
    "therapy_type",
    "Therapy Type",
  ],
  description: ["description", "bio", "profile", "Description"],
  rating: ["rating", "Rating"],
  reviewCount: ["review_count", "reviewCount", "Review Count"],
});

// Language and online availability are not therapist_data columns and are
// deliberately absent: the pipeline never asks about or matches on them.
const CONSTRAINT_COLUMN_MAP = Object.freeze({
  location: COLUMN_MAP.location,
  maximumBudget: COLUMN_MAP.price,
  therapistGenderPreference: COLUMN_MAP.gender,
});

function firstDefined(row, aliases) {
  for (const key of aliases) {
    if (row[key] != null) return row[key];
  }
  return null;
}

function toArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim() !== "") {
    return value.split(",").map((part) => part.trim()).filter(Boolean);
  }
  return [];
}

function toNumberOrNull(value) {
  const number = Number(value);
  return value != null && Number.isFinite(number) ? number : null;
}

// Fallback only for compatible datasets without therapist_id. This internal
// key is a stable selection token, not a therapist fact.
function stableRowId(row) {
  const serialized = JSON.stringify(
    Object.keys(row)
      .sort()
      .map((key) => [key, row[key]])
  );
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `therapist-row-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function normalizeTherapistRecord(row) {
  if (!row) return null;
  const sourceId = firstDefined(row, COLUMN_MAP.id);
  return {
    id: sourceId != null ? String(sourceId) : stableRowId(row),
    name: firstDefined(row, COLUMN_MAP.name),
    location: firstDefined(row, COLUMN_MAP.location),
    neighborhood: firstDefined(row, COLUMN_MAP.neighborhood),
    price: toNumberOrNull(firstDefined(row, COLUMN_MAP.price)),
    gender: firstDefined(row, COLUMN_MAP.gender),
    specialties: toArray(firstDefined(row, COLUMN_MAP.specialties)),
    treatmentApproaches: toArray(
      firstDefined(row, COLUMN_MAP.treatmentApproaches)
    ),
    description: firstDefined(row, COLUMN_MAP.description),
    rating: toNumberOrNull(firstDefined(row, COLUMN_MAP.rating)),
    reviewCount: toNumberOrNull(firstDefined(row, COLUMN_MAP.reviewCount)),
  };
}

export function getTherapistDataCapabilities(rows = []) {
  return Object.fromEntries(
    Object.entries(CONSTRAINT_COLUMN_MAP).map(([field, aliases]) => [
      field,
      rows.some((row) =>
        aliases.some((column) => Object.prototype.hasOwnProperty.call(row, column))
      ),
    ])
  );
}

/** Fetches a bounded set of authoritative therapist profiles directly. */
export async function getTherapistData({ limit = THERAPIST_SCAN_LIMIT } = {}) {
  const boundedLimit = Math.max(
    1,
    Math.min(Number(limit) || THERAPIST_SCAN_LIMIT, 100)
  );
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("*")
    .limit(boundedLimit);

  if (error) {
    throw new Error(`Therapist data lookup failed: ${error.message}`);
  }

  const rows = data || [];
  const profiles = rows
    .map((row) => normalizeTherapistRecord(row))
    .filter((profile) => profile && profile.name != null);
  return {
    profiles,
    availableFields: getTherapistDataCapabilities(rows),
  };
}

/**
 * Legacy therapist-vector lookup, retained only for the separate legacy
 * adapter. The active orchestrator does not send knowledge IDs here.
 */
export async function getTherapistsByIds(ids) {
  const wanted = (ids || []).map(String).filter(Boolean);
  if (wanted.length === 0) return [];

  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("*")
    .in(COLUMN_MAP.id[0], wanted);

  if (error) {
    throw new Error(`Therapist profile lookup failed: ${error.message}`);
  }

  const byId = new Map(
    (data || [])
      .map((row) => normalizeTherapistRecord(row))
      .filter((profile) => profile?.id)
      .map((profile) => [profile.id, profile])
  );
  return wanted.map((id) => byId.get(id)).filter(Boolean);
}

export const THERAPIST_TABLE = TABLE;
export const THERAPIST_COLUMN_MAP = COLUMN_MAP;
