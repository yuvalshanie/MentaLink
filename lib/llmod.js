// Utility wrapper for the custom LLM provider (LLMOD).

const LLMOD_API_KEY = process.env.LLMOD_API_KEY;

export const TEXT_MODEL = "MB5R2CF-azure/gpt-5.4-mini";
export const EMBEDDING_MODEL = "MB5R2CF-azure/text-embedding-3-small";

/**
 * Calls the text generation model.
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>} The model's text response.
 */
export async function callTextModel(systemPrompt, userPrompt) {
  // TODO: Implement the actual API call to the LLMOD provider using
  // LLMOD_API_KEY and TEXT_MODEL, with systemPrompt and userPrompt
  // as the chat messages.
  return "Mock text model response";
}

/**
 * Calls the embedding model.
 * @param {string} text
 * @returns {Promise<number[]>} The embedding vector.
 */
export async function callEmbeddingModel(text) {
  // TODO: Implement the actual API call to the LLMOD provider using
  // LLMOD_API_KEY and EMBEDDING_MODEL to embed the given text.
  return [];
}
