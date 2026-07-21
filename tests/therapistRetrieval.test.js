import { describe, it, expect, beforeEach, vi } from "vitest";
import { pineconeHit, analysisFixture } from "./testUtils";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("../lib/pinecone", () => {
  const index = { query: (...args) => queryMock(...args) };
  index.namespace = () => index;
  const client = { index: () => index };
  return { pinecone: client, getPinecone: () => client };
});

import {
  searchTherapists,
  buildPineconeFilter,
} from "../lib/therapistRetrieval";

beforeEach(() => {
  queryMock.mockReset();
});

describe("buildPineconeFilter", () => {
  it("builds filters only for provided fields", () => {
    const filter = buildPineconeFilter(
      analysisFixture({
        maximumBudget: 300,
        therapistGenderPreference: "Female",
        onlinePreference: true,
        languagePreference: "Russian",
        location: "Haifa",
      })
    );
    expect(filter).toEqual({
      price: { $lte: 300 },
      gender: { $eq: "female" },
      online: { $eq: true },
      languages: { $in: ["Russian"] },
      location: { $eq: "Haifa" },
    });
  });

  it("returns undefined when nothing to filter", () => {
    expect(buildPineconeFilter(analysisFixture())).toBeUndefined();
  });
});

describe("searchTherapists", () => {
  it("returns IDs and similarity scores only, best first", async () => {
    queryMock.mockResolvedValue({
      matches: [pineconeHit("t2", 0.95), pineconeHit("t1", 0.8), { id: 7 }],
    });
    const hits = await searchTherapists({
      vector: [0.1],
      topK: 10,
      analysis: null,
    });
    expect(hits).toEqual([
      { id: "t2", score: 0.95 },
      { id: "t1", score: 0.8 },
      { id: "7", score: null },
    ]);
  });

  it("retries once without filters when a filtered query is empty", async () => {
    queryMock
      .mockResolvedValueOnce({ matches: [] })
      .mockResolvedValueOnce({ matches: [pineconeHit("t1")] });

    const hits = await searchTherapists({
      vector: [0.1],
      topK: 10,
      analysis: analysisFixture({ maximumBudget: 100 }),
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[0][0].filter).toBeDefined();
    expect(queryMock.mock.calls[1][0].filter).toBeUndefined();
    expect(hits.map((h) => h.id)).toEqual(["t1"]);
  });

  it("wraps Pinecone errors with a readable message", async () => {
    queryMock.mockRejectedValue(new Error("index not found"));
    await expect(
      searchTherapists({ vector: [0.1], topK: 10, analysis: null })
    ).rejects.toThrow(/Therapist retrieval failed: index not found/);
  });
});
