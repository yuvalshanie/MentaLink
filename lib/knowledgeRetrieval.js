// Agent-specific document knowledge retrieval. This is deliberately separate
// from therapist candidate selection: document IDs are never sent to Supabase.

import { getPinecone } from "./pinecone";
import { getAgentDataSource } from "./agentDataSources";
import {
  KNOWLEDGE_TOP_K,
  MAX_KNOWLEDGE_CHARS,
  MAX_KNOWLEDGE_CHUNK_CHARS,
  MIN_KNOWLEDGE_CHUNK_CHARS,
} from "./config";

const INDEX_NAME = process.env.PINECONE_KNOWLEDGE_INDEX || "mentalink-data";
const NAMESPACE = process.env.PINECONE_KNOWLEDGE_NAMESPACE || undefined;

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function canonicalText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeTargets(value) {
  if (Array.isArray(value)) return value.map(String);
  return value == null ? [] : [String(value)];
}

/**
 * Retrieves bounded knowledge for exactly one application agent.
 * Pinecone filtering is repeated locally as defense in depth.
 */
export async function searchKnowledgeForAgent({
  agentModule,
  queryEmbedding,
  topK = KNOWLEDGE_TOP_K,
}) {
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
    throw new Error("Knowledge retrieval requires a non-empty query embedding.");
  }

  const { pineconeTarget } = getAgentDataSource(agentModule);
  let index = getPinecone().index(INDEX_NAME);
  if (NAMESPACE) index = index.namespace(NAMESPACE);

  let result;
  try {
    result = await index.query({
      vector: queryEmbedding,
      topK: Math.max(1, Math.min(Number(topK) || KNOWLEDGE_TOP_K, 50)),
      includeMetadata: true,
      filter: { agent_targets: { $in: [pineconeTarget] } },
    });
  } catch (error) {
    throw new Error(`Knowledge retrieval failed for ${agentModule}: ${error.message}`);
  }

  const seen = new Set();
  const records = [];
  let usedChars = 0;

  for (const match of result?.matches || []) {
    const metadata = match?.metadata || {};
    const agentTargets = normalizeTargets(metadata.agent_targets);
    const text = cleanText(metadata.text);
    if (!agentTargets.includes(pineconeTarget)) continue;
    // Empty or excessively short chunks carry no usable knowledge.
    if (text.length < MIN_KNOWLEDGE_CHUNK_CHARS) continue;

    // Exact and strong-prefix deduplication removes repeated/near-identical
    // chunks without introducing an additional model call.
    const canonical = canonicalText(text);
    const signature = canonical.length > 240 ? canonical.slice(0, 240) : canonical;
    if (signature === "" || seen.has(signature)) continue;

    const boundedText = text.slice(0, MAX_KNOWLEDGE_CHUNK_CHARS);
    if (usedChars + boundedText.length > MAX_KNOWLEDGE_CHARS) break;
    seen.add(signature);
    usedChars += boundedText.length;
    records.push({
      id: String(match.id),
      score: typeof match.score === "number" ? match.score : null,
      text: boundedText,
      sourceFile: cleanText(metadata.source_file) || null,
      agentTargets,
    });
  }

  return records;
}
