import { describe, expect, it } from "vitest";
import { toFriendlyError } from "../lib/clientErrors";

describe("toFriendlyError", () => {
  it.each([
    'LLMod request to /chat/completions failed with HTTP 400. {"error":{"code":"content_filter"}}',
    "The response was filtered due to Azure OpenAI content management policy (ResponsibleAIPolicyViolation)",
    "Error: something at Object.<anonymous> stack trace",
    '{"error":{"message":"raw provider json"}}',
    "https://api.llmod.ai/v1/embeddings returned 500",
    "",
  ])("hides technical content: %j", (raw) => {
    const friendly = toFriendlyError(raw);
    expect(friendly).toBe(
      "Something went wrong while processing your request. Please try again."
    );
    expect(friendly).not.toMatch(/azure|content_filter|chat\/completions|http/i);
  });

  it("passes short human-readable messages through", () => {
    expect(toFriendlyError("Prompt is too long (13000 characters, maximum 12000).")).toBe(
      "Prompt is too long (13000 characters, maximum 12000)."
    );
    expect(
      toFriendlyError("The language-model request timed out. Please try again.")
    ).toBe("The language-model request timed out. Please try again.");
  });
});
