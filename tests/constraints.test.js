import { describe, expect, it } from "vitest";
import {
  applyHardConstraints,
  getUnverifiedPreferences,
  genderMatches,
  HARD_CONSTRAINT_FIELDS,
} from "../lib/constraints";

const capabilities = {
  location: true,
  maximumBudget: true,
  therapistGenderPreference: true,
};

const profiles = [
  { id: "1", price: 300, gender: "female", location: "Haifa" },
  { id: "2", price: 400, gender: "male", location: "Tel Aviv" },
];

describe("therapist constraint verification", () => {
  it("supports only fields present in the live therapist_data schema", () => {
    expect(HARD_CONSTRAINT_FIELDS).toEqual([
      "location",
      "maximumBudget",
      "therapistGenderPreference",
    ]);
  });

  it("enforces explicit gender mismatch when gender exists", () => {
    const { kept } = applyHardConstraints(
      profiles,
      {
        therapistGenderPreference: "female",
        hardConstraints: ["therapistGenderPreference"],
      },
      capabilities
    );
    expect(kept.map((profile) => profile.id)).toEqual(["1"]);
  });

  it("enforces price mismatch through normalized price_nis", () => {
    const { kept } = applyHardConstraints(
      profiles,
      { maximumBudget: 350, hardConstraints: ["maximumBudget"] },
      capabilities
    );
    expect(kept.map((profile) => profile.id)).toEqual(["1"]);
  });

  it("matches gender across languages and synonyms", () => {
    const female = { gender: "Female" };
    expect(genderMatches(female, "female")).toBe(true);
    expect(genderMatches(female, "woman")).toBe(true);
    expect(genderMatches(female, "מטפלת")).toBe(true);
    expect(genderMatches(female, "אישה")).toBe(true);
    expect(genderMatches({ gender: "Male" }, "מטפל")).toBe(true);
    expect(genderMatches(female, "male")).toBe(false);
    expect(genderMatches({ gender: null }, "female")).toBe(false);
  });

  it("enforces a hard Hebrew gender constraint", () => {
    const { kept } = applyHardConstraints(
      profiles,
      {
        therapistGenderPreference: "מטפלת",
        hardConstraints: ["therapistGenderPreference"],
      },
      capabilities
    );
    expect(kept.map((profile) => profile.id)).toEqual(["1"]);
  });

  it("enforces a hard region constraint through the district mapping", () => {
    const { kept } = applyHardConstraints(
      profiles,
      { location: "the north", hardConstraints: ["location"] },
      capabilities
    );
    // Haifa is a north-district city; Tel Aviv is not.
    expect(kept.map((profile) => profile.id)).toEqual(["1"]);
  });

  it("enforces a hard Hebrew region constraint", () => {
    const { kept } = applyHardConstraints(
      profiles,
      { location: "במרכז", hardConstraints: ["location"] },
      capabilities
    );
    expect(kept.map((profile) => profile.id)).toEqual(["2"]);
  });

  it("ignores stale language/online identifiers instead of filtering on them", () => {
    const { kept, unverifiedPreferences } = applyHardConstraints(
      profiles,
      {
        languagePreference: "English",
        onlinePreference: true,
        hardConstraints: ["languagePreference", "onlinePreference"],
      },
      capabilities
    );
    expect(kept).toHaveLength(2);
    expect(unverifiedPreferences).toEqual([]);
  });

  it("marks a supported field unverified only when its column is unavailable", () => {
    const noGenderColumn = { ...capabilities, therapistGenderPreference: false };
    const { kept, unverifiedPreferences } = applyHardConstraints(
      profiles,
      {
        therapistGenderPreference: "female",
        hardConstraints: ["therapistGenderPreference"],
      },
      noGenderColumn
    );
    expect(kept).toHaveLength(2);
    expect(unverifiedPreferences).toEqual([
      {
        field: "therapistGenderPreference",
        label: "therapist gender",
        requestedValue: "female",
        status: "unverified",
      },
    ]);
  });

  it("never reports language or online as unverified preferences", () => {
    expect(
      getUnverifiedPreferences(
        {
          languagePreference: "English",
          onlinePreference: true,
          softPreferences: ["languagePreference", "onlinePreference"],
        },
        { languagePreference: false, onlinePreference: false }
      )
    ).toEqual([]);
  });
});
