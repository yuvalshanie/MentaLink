import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MODULE_MATCHMAKER,
  MODULE_GUARDIAN,
} from "../lib/agentDataSources";

const { queryMock, indexMock } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const indexMock = { query: (...args) => queryMock(...args) };
  indexMock.namespace = () => indexMock;
  return { queryMock, indexMock };
});

vi.mock("../lib/pinecone", () => ({
  getPinecone: () => ({ index: () => indexMock }),
}));

import { searchKnowledgeForAgent } from "../lib/knowledgeRetrieval";

function chunk(
  id,
  targets,
  text = `knowledge ${id} — general reference content used in retrieval tests.`,
  source = "source.txt"
) {
  return {
    id,
    score: 0.8,
    metadata: { agent_targets: targets, text, source_file: source },
  };
}

beforeEach(() => queryMock.mockReset());

describe("searchKnowledgeForAgent", () => {
  it("uses exact Matchmaker routing and requests metadata", async () => {
    queryMock.mockResolvedValue({
      matches: [chunk("m", ["Matchmaker Agent"])],
    });
    const records = await searchKnowledgeForAgent({
      agentModule: MODULE_MATCHMAKER,
      queryEmbedding: [0.1, 0.2],
      topK: 5,
    });

    expect(queryMock).toHaveBeenCalledWith({
      vector: [0.1, 0.2],
      topK: 5,
      includeMetadata: true,
      filter: { agent_targets: { $in: ["Matchmaker Agent"] } },
    });
    expect(records[0]).toEqual({
      id: "m",
      score: 0.8,
      text: "knowledge m — general reference content used in retrieval tests.",
      sourceFile: "source.txt",
      agentTargets: ["Matchmaker Agent"],
    });
  });

  it("uses exact Guardian routing", async () => {
    queryMock.mockResolvedValue({
      matches: [chunk("g", ["Ethical Guardian Agent"])],
    });
    await searchKnowledgeForAgent({
      agentModule: MODULE_GUARDIAN,
      queryEmbedding: [0.1],
    });
    expect(queryMock.mock.calls[0][0].filter).toEqual({
      agent_targets: { $in: ["Ethical Guardian Agent"] },
    });
  });

  it("keeps shared chunks while enforcing isolation locally", async () => {
    const matches = [
      chunk("m", ["Matchmaker Agent"]),
      chunk("g", ["Ethical Guardian Agent"]),
      chunk("shared", ["Matchmaker Agent", "Ethical Guardian Agent"]),
    ];
    queryMock.mockResolvedValue({ matches });

    const matchmaker = await searchKnowledgeForAgent({
      agentModule: MODULE_MATCHMAKER,
      queryEmbedding: [0.1],
    });
    const guardian = await searchKnowledgeForAgent({
      agentModule: MODULE_GUARDIAN,
      queryEmbedding: [0.1],
    });

    expect(matchmaker.map((record) => record.id)).toEqual(["m", "shared"]);
    expect(guardian.map((record) => record.id)).toEqual(["g", "shared"]);
  });

  it("drops empty, too-short, and repeated or near-identical chunks", async () => {
    const usefulText =
      "The same genuinely useful reference text about therapy approaches.";
    queryMock.mockResolvedValue({
      matches: [
        chunk("empty", ["Matchmaker Agent"], "  "),
        chunk("too-short", ["Matchmaker Agent"], "tiny fragment"),
        chunk("a", ["Matchmaker Agent"], usefulText),
        chunk("b", ["Matchmaker Agent"], usefulText.toUpperCase()),
      ],
    });
    const records = await searchKnowledgeForAgent({
      agentModule: MODULE_MATCHMAKER,
      queryEmbedding: [0.1],
    });
    expect(records.map((record) => record.id)).toEqual(["a"]);
  });

});
