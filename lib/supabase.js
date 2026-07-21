import { createClient } from "@supabase/supabase-js";

// Lazy initialization: constructing the client at module load crashes
// `next build` (and any environment without the Supabase vars set).
// The client is only ever used server-side (API routes / lib), and only the
// anon key is used — no service-role key, no secrets logged.
let client = null;

export function getSupabase() {
  if (!client) {
    const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!configuredUrl || !key) {
      throw new Error(
        "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
      );
    }
    // Accept either the Supabase project origin or a pasted REST endpoint.
    // createClient itself requires the project origin.
    let url;
    try {
      url = new URL(configuredUrl).origin;
    } catch {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid absolute URL.");
    }
    client = createClient(url, key);
  }
  return client;
}

// Backwards-compatible `supabase` export for existing code: behaves like the
// client instance but defers construction until first use.
export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = getSupabase()[prop];
      return typeof value === "function" ? value.bind(getSupabase()) : value;
    },
  }
);
