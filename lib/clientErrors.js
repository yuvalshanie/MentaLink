// Client-facing error sanitization. Provider/internal errors must never be
// shown verbatim: anything technical (endpoints, HTTP codes, Azure or
// content-filter internals, JSON fragments, stacks) collapses into one short
// human-readable message. Short plain sentences pass through unchanged.

const TECHNICAL_MARKERS =
  /https?:\/\/|\/chat\/completions|\/embeddings|azure|openai|llmod|content_filter|content.?policy|responsibleai|api.?key|bearer|status code|\bHTTP\b|\bstack\b|traceback|[{}[\]]/i;

export function toFriendlyError(message) {
  const text = String(message || "").trim();
  if (text === "" || text.length > 220 || TECHNICAL_MARKERS.test(text)) {
    return "Something went wrong while processing your request. Please try again.";
  }
  return text;
}
