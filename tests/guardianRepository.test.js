import { describe, it, expect, beforeEach, vi } from "vitest";

const { state, fromMock, limitMock } = vi.hoisted(() => ({
  state: { rows: [], error: null },
  fromMock: vi.fn(),
  limitMock: vi.fn(),
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
        }),
      };
    },
  }),
}));

import {
  getGuardianReferenceData,
  normalizeGuardianReference,
} from "../lib/guardianRepository";

beforeEach(() => {
  state.rows = [];
  state.error = null;
  fromMock.mockReset();
  limitMock.mockReset();
});

describe("Guardian Supabase references", () => {
  it("uses only mental_health_diagnosis_treatment and removes identifiers", async () => {
    state.rows = [
      {
        "Patient ID": "private-1",
        Age: 30,
        Gender: "female",
        Diagnosis: "Anxiety",
        Medication: "Reference medication",
        "Therapy Type": "CBT",
        Outcome: "Improved",
      },
    ];
    const references = await getGuardianReferenceData({
      analysis: { concerns: ["anxiety"] },
    });
    expect(fromMock).toHaveBeenCalledWith("mental_health_diagnosis_treatment");
    expect(references).toHaveLength(1);
    expect(references[0].diagnosis).toBe("Anxiety");
    expect(references[0]).not.toHaveProperty("Patient ID");
    expect(references[0]).not.toHaveProperty("patientId");
    expect(references[0]).not.toHaveProperty("Age");
  });

  it("normalizes the verified safety-reference columns", () => {
    const reference = normalizeGuardianReference({
      Diagnosis: "Depression",
      "Symptom Severity (1-10)": 7,
      "Therapy Type": "Counselling",
      "AI-Detected Emotional State": "sad",
    });
    expect(reference.diagnosis).toBe("Depression");
    expect(reference.symptomSeverity).toBe(7);
    expect(reference.therapyType).toBe("Counselling");
    expect(reference.emotionalState).toBe("sad");
  });

  it("reports source failure to the orchestrator", async () => {
    state.error = { message: "permission denied" };
    await expect(getGuardianReferenceData()).rejects.toThrow(
      /Guardian reference lookup failed: permission denied/
    );
  });
});
