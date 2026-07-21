import { describe, it, expect, beforeEach, vi } from "vitest";

const { agentMock } = vi.hoisted(() => ({ agentMock: vi.fn() }));

vi.mock("@/lib/orchestrator", () => ({ runMentaLinkAgent: agentMock }));

import { POST } from "../app/api/execute/route";

function makeRequest(body) {
  return new Request("http://localhost/api/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  agentMock.mockReset();
});

const SCHEMA_KEYS = ["error", "response", "status", "steps"];

describe("POST /api/execute — schema", () => {
  it("returns the exact success schema", async () => {
    const steps = [
      {
        module: "UserRequestAnalyzer",
        prompt: { System_prompt: "s", User_prompt: "u" },
        response: { concerns: [] },
      },
      {
        module: "MatchmakerAgent",
        prompt: { System_prompt: "s", User_prompt: "u" },
        response: {},
      },
      {
        module: "EthicalGuardianAgent",
        prompt: { System_prompt: "s", User_prompt: "u" },
        response: {},
      },
    ];
    agentMock.mockResolvedValue({ response: "Final answer", steps });

    const res = await POST(makeRequest({ prompt: "I feel anxious" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual(SCHEMA_KEYS);
    expect(json).toEqual({
      status: "ok",
      error: null,
      response: "Final answer",
      steps,
    });
    // Steps stay chronological and use the shared module names.
    expect(json.steps.map((s) => s.module)).toEqual([
      "UserRequestAnalyzer",
      "MatchmakerAgent",
      "EthicalGuardianAgent",
    ]);
  });

  it("reports an internally handled crisis as ok with empty steps", async () => {
    agentMock.mockResolvedValue({
      response: "Safety-focused crisis response.",
      steps: [],
    });
    const res = await POST(makeRequest({ prompt: "handled crisis input" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      status: "ok",
      error: null,
      response: "Safety-focused crisis response.",
      steps: [],
    });
  });

  it("returns the exact error schema for a missing prompt", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual(SCHEMA_KEYS);
    expect(json.status).toBe("error");
    expect(typeof json.error).toBe("string");
    expect(json.response).toBeNull();
    expect(json.steps).toEqual([]);
    expect(agentMock).not.toHaveBeenCalled();
  });

  it("rejects an empty-string prompt", async () => {
    const res = await POST(makeRequest({ prompt: "   " }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.status).toBe("error");
  });

  it("rejects a non-JSON body with the error schema", async () => {
    const res = await POST(makeRequest("not json {"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual(SCHEMA_KEYS);
    expect(json.status).toBe("error");
  });

  it("maps agent failures to the error schema", async () => {
    agentMock.mockRejectedValue(new Error("Therapist retrieval failed: down"));
    const res = await POST(makeRequest({ prompt: "anxious" }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({
      status: "error",
      error: "Therapist retrieval failed: down",
      response: null,
      steps: [],
    });
  });
});
