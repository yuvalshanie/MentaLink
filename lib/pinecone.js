import { Pinecone } from "@pinecone-database/pinecone";

// Lazy initialization: constructing the client at module load crashes
// `next build` (and any environment without PINECONE_API_KEY set).
let client = null;

export function getPinecone() {
  if (!client) {
    client = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
  }
  return client;
}

// Backwards-compatible `pinecone` export for existing code: behaves like the
// client instance but defers construction until first use.
export const pinecone = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = getPinecone()[prop];
      return typeof value === "function" ? value.bind(getPinecone()) : value;
    },
  }
);
