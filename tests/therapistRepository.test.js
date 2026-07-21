import { describe, it, expect, beforeEach, vi } from "vitest";

const { state, fromMock, limitMock, inMock } = vi.hoisted(() => ({
  state: { rows: [], error: null },
  fromMock: vi.fn(),
  limitMock: vi.fn(),
  inMock: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    from: (table) => {
      fromMock(table);
      return {
        select: () => ({
          limit: (limit) => {
            limitMock(limit);
            return Promise.resolve({ data: state.rows, error: state.error });
          },
          in: (column, ids) => {
            inMock(column, ids);
            return Promise.resolve({ data: state.rows, error: state.error });
          },
        }),
      };
    },
  }),
}));

import {
  getTherapistData,
  getTherapistsByIds,
  getTherapistDataCapabilities,
  normalizeTherapistRecord,
} from "../lib/therapistRepository";

beforeEach(() => {
  state.rows = [];
  state.error = null;
  fromMock.mockReset();
  limitMock.mockReset();
  inMock.mockReset();
});

describe("therapist_data repository", () => {
  it("normalizes every verified live column", () => {
    const profile = normalizeTherapistRecord({
      therapist_id: 42,
      name: "Noa",
      city: "Haifa",
      neighborhood: "Carmel",
      price_nis: "320",
      gender: "female",
      therapy_type: "CBT",
      rating: "4.7",
      review_count: "18",
    });
    expect(profile.id).toBe("42");
    expect(profile.name).toBe("Noa");
    expect(profile.location).toBe("Haifa");
    expect(profile.neighborhood).toBe("Carmel");
    expect(profile.price).toBe(320);
    expect(profile.gender).toBe("female");
    expect(profile.treatmentApproaches).toEqual(["CBT"]);
    expect(profile.rating).toBe(4.7);
    expect(profile.reviewCount).toBe(18);
    // The live schema has no language/online columns — the normalized
    // profile must not even carry those keys.
    expect(profile).not.toHaveProperty("languages");
    expect(profile).not.toHaveProperty("online");
  });

  it("reports only supported constraint capabilities", () => {
    const capabilities = getTherapistDataCapabilities([
      {
        therapist_id: 1,
        city: "Haifa",
        price_nis: 300,
        gender: "female",
      },
    ]);
    expect(capabilities).toEqual({
      location: true,
      maximumBudget: true,
      therapistGenderPreference: true,
    });
    expect(capabilities).not.toHaveProperty("languagePreference");
    expect(capabilities).not.toHaveProperty("onlinePreference");
  });

  it("marks a missing supported column as unavailable instead of inventing it", () => {
    const capabilities = getTherapistDataCapabilities([
      { therapist_id: 1, city: "Haifa", price_nis: 300 },
    ]);
    expect(capabilities.therapistGenderPreference).toBe(false);
  });

  it("uses therapist_data directly without Pinecone IDs", async () => {
    state.rows = [
      { therapist_id: 1, name: "Noa", city: "Haifa", gender: "female" },
    ];
    const { profiles, availableFields } = await getTherapistData({ limit: 20 });
    expect(fromMock).toHaveBeenCalledWith("therapist_data");
    expect(limitMock).toHaveBeenCalledWith(20);
    expect(inMock).not.toHaveBeenCalled();
    expect(profiles[0].name).toBe("Noa");
    expect(availableFields.location).toBe(true);
  });

  it("never returns nameless rows as therapist candidates", async () => {
    state.rows = [{ city: "Haifa" }, { name: "Noa" }];
    const { profiles } = await getTherapistData();
    expect(profiles).toHaveLength(1);
  });

  it("wraps therapist_data failures", async () => {
    state.error = { message: "database unavailable" };
    await expect(getTherapistData()).rejects.toThrow(
      /Therapist data lookup failed: database unavailable/
    );
  });

  it("retains the separate legacy ID lookup without using it in the active flow", async () => {
    state.rows = [{ therapist_id: "t1", name: "Noa" }];
    const profiles = await getTherapistsByIds(["t1"]);
    expect(inMock).toHaveBeenCalledWith("therapist_id", ["t1"]);
    expect(profiles[0].id).toBe("t1");
  });
});
