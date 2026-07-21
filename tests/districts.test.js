import { describe, expect, it } from "vitest";
import {
  resolveDistrict,
  districtOfCity,
  canonicalCity,
} from "../lib/districts";
import { locationMatches } from "../lib/constraints";

describe("district resolution", () => {
  it("resolves English region phrases", () => {
    expect(resolveDistrict("north")).toBe("north");
    expect(resolveDistrict("The North")).toBe("north");
    expect(resolveDistrict("center of the country")).toBe("center");
    expect(resolveDistrict("the south")).toBe("south");
    expect(resolveDistrict("Jerusalem area")).toBe("jerusalem");
  });

  it("resolves Hebrew region phrases", () => {
    expect(resolveDistrict("צפון")).toBe("north");
    expect(resolveDistrict("בצפון")).toBe("north");
    expect(resolveDistrict("המרכז")).toBe("center");
    expect(resolveDistrict("הדרום")).toBe("south");
    expect(resolveDistrict("אזור ירושלים")).toBe("jerusalem");
  });

  it("returns null for cities and unknown text", () => {
    expect(resolveDistrict("Haifa")).toBeNull();
    expect(resolveDistrict("somewhere")).toBeNull();
    expect(resolveDistrict("")).toBeNull();
    expect(resolveDistrict(null)).toBeNull();
  });

  it("maps dataset cities to districts", () => {
    expect(districtOfCity("Haifa")).toBe("north");
    expect(districtOfCity("Tel Aviv")).toBe("center");
    expect(districtOfCity("Petah Tikva")).toBe("center");
    expect(districtOfCity("Rishon LeZion")).toBe("center");
    expect(districtOfCity("Jerusalem")).toBe("jerusalem");
    expect(districtOfCity("Unknown City")).toBeNull();
  });

  it("recognizes Hebrew city spellings", () => {
    expect(canonicalCity("חיפה")).toBe("haifa");
    expect(canonicalCity("תל אביב")).toBe("tel aviv");
    expect(districtOfCity("חיפה")).toBe("north");
  });
});

describe("locationMatches with regions", () => {
  const haifa = { location: "Haifa" };
  const telAviv = { location: "Tel Aviv" };
  const jerusalem = { location: "Jerusalem" };

  it("matches a region request to cities in that district", () => {
    expect(locationMatches(haifa, "north")).toBe(true);
    expect(locationMatches(haifa, "the north")).toBe(true);
    expect(locationMatches(haifa, "בצפון")).toBe(true);
    expect(locationMatches(telAviv, "north")).toBe(false);
    expect(locationMatches(telAviv, "the center")).toBe(true);
    expect(locationMatches(jerusalem, "אזור ירושלים")).toBe(true);
    expect(locationMatches(jerusalem, "the center")).toBe(false);
  });

  it("keeps specific city requests specific", () => {
    expect(locationMatches(haifa, "Haifa")).toBe(true);
    expect(locationMatches(haifa, "Tel Aviv")).toBe(false);
    // A different north-district city is NOT a match for a city request.
    expect(locationMatches(haifa, "Nahariya")).toBe(false);
  });

  it("matches cities across languages", () => {
    expect(locationMatches(haifa, "חיפה")).toBe(true);
    expect(locationMatches(telAviv, "תל אביב")).toBe(true);
    expect(locationMatches(haifa, "תל אביב")).toBe(false);
  });

  it("never matches a missing profile location", () => {
    expect(locationMatches({ location: null }, "north")).toBe(false);
  });
});
