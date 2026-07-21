// ---------------------------------------------------------------------------
// Therapist semantic-search adapter — the ONLY module that talks to Pinecone.
//
// Pinecone is used exclusively for vector retrieval: it returns candidate
// therapist IDs and similarity scores. The full structured profiles are
// fetched from Supabase (the source of truth) via lib/therapistRepository.js.
//
// The Pinecone dataset, embeddings, and index are owned by another team
// member. This adapter wraps the existing Pinecone client (lib/pinecone.js)
// so the rest of the pipeline never touches Pinecone directly.
//
// TEAMMATE NOTES:
// - Index name comes from PINECONE_INDEX (default "therapists").
// - Optional namespace via PINECONE_NAMESPACE.
// - The vector id is assumed to equal the Supabase primary key; if not,
//   map it here (and/or in lib/therapistRepository.js COLUMN_MAP).
// - Metadata filters below only apply if your records store this metadata;
//   if your field names differ, update FIELD_MAP here. If no such metadata
//   exists, the filters simply never match and the unfiltered fallback plus
//   the deterministic post-filter (lib/constraints.js) still guarantee
//   correct results.
// - If you already have a dedicated query function, replace the body of
//   `searchTherapists` with a call to it; keep the {id, score} return shape.
// ---------------------------------------------------------------------------

import { getPinecone } from "./pinecone";

// normalized field name -> Pinecone metadata field name (filtering only)
const FIELD_MAP = {
  location: "location",
  price: "price",
  languages: "languages",
  gender: "gender",
  online: "online",
};

const INDEX_NAME = process.env.PINECONE_INDEX || "therapists";
const NAMESPACE = process.env.PINECONE_NAMESPACE || undefined;

/**
 * Builds a Pinecone metadata filter from the structured request analysis.
 * Only used when the index stores this metadata; harmless otherwise.
 */
export function buildPineconeFilter(analysis) {
  const filter = {};
  if (analysis?.maximumBudget != null) {
    filter[FIELD_MAP.price] = { $lte: analysis.maximumBudget };
  }
  if (analysis?.therapistGenderPreference) {
    filter[FIELD_MAP.gender] = {
      $eq: String(analysis.therapistGenderPreference).toLowerCase(),
    };
  }
  if (analysis?.onlinePreference === true) {
    filter[FIELD_MAP.online] = { $eq: true };
  }
  if (analysis?.languagePreference) {
    filter[FIELD_MAP.languages] = { $in: [analysis.languagePreference] };
  }
  if (analysis?.location) {
    filter[FIELD_MAP.location] = { $eq: analysis.location };
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

/**
 * Semantic search for therapist candidates.
 *
 * @param {object} args
 * @param {number[]} args.vector - query embedding
 * @param {number} args.topK
 * @param {object|null} [args.analysis] - structured request analysis used to
 *   build optional metadata filters.
 * @returns {Promise<Array<{id: string, score: number|null}>>}
 *   candidate therapist IDs with similarity scores, best first.
 */
export async function searchTherapists({ vector, topK, analysis }) {
  let index = getPinecone().index(INDEX_NAME);
  if (NAMESPACE) index = index.namespace(NAMESPACE);

  const baseQuery = { vector, topK, includeMetadata: false };

  const filter = buildPineconeFilter(analysis);
  let result;
  try {
    result = await index.query(filter ? { ...baseQuery, filter } : baseQuery);
  } catch (err) {
    throw new Error(`Therapist retrieval failed: ${err.message}`);
  }

  let matches = result?.matches || [];

  // A filtered query can be over-strict (differing metadata values, or no
  // metadata stored at all). If it returns nothing, retry once without the
  // filter; deterministic hard-constraint filtering happens later anyway.
  if (matches.length === 0 && filter) {
    try {
      result = await index.query(baseQuery);
      matches = result?.matches || [];
    } catch (err) {
      throw new Error(`Therapist retrieval failed: ${err.message}`);
    }
  }

  return matches
    .filter((m) => m?.id != null)
    .map((m) => ({
      id: String(m.id),
      score: typeof m.score === "number" ? m.score : null,
    }));
}
