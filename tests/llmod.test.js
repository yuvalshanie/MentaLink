import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  extractJson,
  callTextModel,
  callEmbeddingModel,
  isContentPolicyError,
} from "../lib/llmod";
import { okJson } from "./testUtils";

beforeEach(() => {
  process.env.LLMOD_API_KEY = "test-key-secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("parses fenced JSON", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("parses JSON embedded in prose", () => {
    expect(extractJson('Here you go: {"a":1} hope it helps')).toEqual({ a: 1 });
  });
  it("returns null for garbage", () => {
    expect(extractJson("no json here")).toBeNull();
  });
});

describe("callTextModel", () => {
  it("fails clearly without an API key", async () => {
    delete process.env.LLMOD_API_KEY;
    await expect(callTextModel("s", "u")).rejects.toThrow(/LLMOD_API_KEY/);
  });

  it("sends the right payload and returns the content", async () => {
    const fetchMock = vi.fn(async () =>
      okJson({ choices: [{ message: { content: "hello" } }] })
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await callTextModel("system", "user");
    expect(out).toBe("hello");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/chat\/completions$/);
    const body = JSON.parse(init.body);
    expect(body.model).toBe("MB5R2CF-azure/gpt-5.4-mini");
    expect(body.messages).toEqual([
      { role: "system", content: "system" },
      { role: "user", content: "user" },
    ]);
    expect(init.headers.Authorization).toBe("Bearer test-key-secret");
  });

  it("does not leak the API key or provider body in HTTP error messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "azure internal detail that must stay hidden",
      }))
    );
    await expect(callTextModel("s", "u")).rejects.toSatisfy(
      (err) =>
        !err.message.includes("test-key-secret") &&
        !err.message.includes("azure internal") &&
        !err.message.includes("/chat/completions") &&
        /language-model service returned an error/.test(err.message)
    );
  });

  it("classifies Azure content-filter HTTP 400 as a typed content-policy error", async () => {
    const azureBody =
      '{"error":{"code":"content_filter","message":"The response was filtered due to the prompt triggering Azure OpenAI\'s content management policy. ResponsibleAIPolicyViolation"}}';
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400, text: async () => azureBody }))
    );
    let caught;
    try {
      await callTextModel("s", "u");
    } catch (err) {
      caught = err;
    }
    expect(isContentPolicyError(caught)).toBe(true);
    // The raw provider body never appears on the error.
    expect(caught.message).not.toMatch(/azure|filtered|ResponsibleAI/i);
    expect(caught.message).toMatch(/declined to process/);
  });

  it("does not classify a generic HTTP 400 as content policy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => '{"error":{"message":"missing model parameter"}}',
      }))
    );
    let caught;
    try {
      await callTextModel("s", "u");
    } catch (err) {
      caught = err;
    }
    expect(isContentPolicyError(caught)).toBe(false);
  });
});

describe("callEmbeddingModel", () => {
  it("returns the embedding vector", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okJson({ data: [{ embedding: [1, 2, 3] }] }))
    );
    await expect(callEmbeddingModel("text")).resolves.toEqual([1, 2, 3]);
  });

  it("rejects an invalid embedding response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ data: [] })));
    await expect(callEmbeddingModel("text")).rejects.toThrow(/invalid embedding/);
  });
});
