// Region (district) layer for location matching. A user may state a region
// ("the north", "המרכז") instead of a city; therapist_data stores cities, so
// requests are resolved here: region -> district -> dataset cities.
// English and Hebrew spellings are both recognized. Purely deterministic —
// no LLM calls and no invented locations.

const CITIES = Object.freeze([
  // north
  { canonical: "haifa", district: "north", names: ["haifa", "חיפה"] },
  { canonical: "nahariya", district: "north", names: ["nahariya", "נהריה"] },
  { canonical: "acre", district: "north", names: ["acre", "akko", "עכו"] },
  { canonical: "karmiel", district: "north", names: ["karmiel", "כרמיאל"] },
  { canonical: "nazareth", district: "north", names: ["nazareth", "נצרת"] },
  { canonical: "tiberias", district: "north", names: ["tiberias", "טבריה"] },
  { canonical: "safed", district: "north", names: ["safed", "tzfat", "צפת"] },
  { canonical: "afula", district: "north", names: ["afula", "עפולה"] },
  { canonical: "hadera", district: "north", names: ["hadera", "חדרה"] },
  {
    canonical: "kiryat bialik",
    district: "north",
    names: ["kiryat bialik", "קרית ביאליק", "קריית ביאליק"],
  },
  // center
  { canonical: "tel aviv", district: "center", names: ["tel aviv", "tel aviv-yafo", "תל אביב"] },
  { canonical: "ramat gan", district: "center", names: ["ramat gan", "רמת גן"] },
  { canonical: "givatayim", district: "center", names: ["givatayim", "גבעתיים"] },
  {
    canonical: "petah tikva",
    district: "center",
    names: ["petah tikva", "petach tikva", "פתח תקווה", "פתח תקוה"],
  },
  {
    canonical: "rishon lezion",
    district: "center",
    names: ["rishon lezion", "rishon letzion", "ראשון לציון"],
  },
  { canonical: "holon", district: "center", names: ["holon", "חולון"] },
  { canonical: "bat yam", district: "center", names: ["bat yam", "בת ים"] },
  { canonical: "bnei brak", district: "center", names: ["bnei brak", "בני ברק"] },
  { canonical: "herzliya", district: "center", names: ["herzliya", "הרצליה"] },
  { canonical: "raanana", district: "center", names: ["raanana", "ra'anana", "רעננה"] },
  { canonical: "kfar saba", district: "center", names: ["kfar saba", "כפר סבא"] },
  { canonical: "netanya", district: "center", names: ["netanya", "נתניה"] },
  { canonical: "rehovot", district: "center", names: ["rehovot", "רחובות"] },
  { canonical: "ness ziona", district: "center", names: ["ness ziona", "נס ציונה"] },
  { canonical: "lod", district: "center", names: ["lod", "לוד"] },
  { canonical: "ramla", district: "center", names: ["ramla", "רמלה"] },
  { canonical: "modiin", district: "center", names: ["modiin", "modi'in", "מודיעין"] },
  // jerusalem
  { canonical: "jerusalem", district: "jerusalem", names: ["jerusalem", "ירושלים"] },
  { canonical: "beit shemesh", district: "jerusalem", names: ["beit shemesh", "בית שמש"] },
  {
    canonical: "mevaseret zion",
    district: "jerusalem",
    names: ["mevaseret zion", "מבשרת ציון"],
  },
  // south
  {
    canonical: "beer sheva",
    district: "south",
    names: ["beer sheva", "be'er sheva", "beersheba", "באר שבע"],
  },
  { canonical: "ashdod", district: "south", names: ["ashdod", "אשדוד"] },
  { canonical: "ashkelon", district: "south", names: ["ashkelon", "אשקלון"] },
  { canonical: "eilat", district: "south", names: ["eilat", "אילת"] },
  { canonical: "dimona", district: "south", names: ["dimona", "דימונה"] },
  { canonical: "kiryat gat", district: "south", names: ["kiryat gat", "קרית גת", "קריית גת"] },
  { canonical: "sderot", district: "south", names: ["sderot", "שדרות"] },
  { canonical: "arad", district: "south", names: ["arad", "ערד"] },
]);

const DISTRICT_ALIASES = Object.freeze({
  north: [
    "north",
    "the north",
    "northern",
    "northern israel",
    "north israel",
    "north of israel",
    "north district",
    "in the north",
    "צפון",
    "הצפון",
    "בצפון",
    "אזור הצפון",
    "צפון הארץ",
  ],
  center: [
    "center",
    "the center",
    "central",
    "central israel",
    "center of israel",
    "center district",
    "center of the country",
    "in the center",
    "gush dan",
    "מרכז",
    "המרכז",
    "במרכז",
    "אזור המרכז",
    "מרכז הארץ",
    "גוש דן",
  ],
  jerusalem: [
    "jerusalem area",
    "jerusalem district",
    "jerusalem region",
    "אזור ירושלים",
    "ירושלים והסביבה",
  ],
  south: [
    "south",
    "the south",
    "southern",
    "southern israel",
    "south israel",
    "south of israel",
    "south district",
    "in the south",
    "דרום",
    "הדרום",
    "בדרום",
    "אזור הדרום",
    "דרום הארץ",
  ],
});

function norm(value) {
  return String(value ?? "").trim().toLowerCase();
}

/** District key for a region phrase ("the north", "בצפון"), or null. */
export function resolveDistrict(text) {
  const wanted = norm(text);
  if (wanted === "") return null;
  for (const [district, aliases] of Object.entries(DISTRICT_ALIASES)) {
    if (aliases.includes(wanted)) return district;
  }
  return null;
}

function findCity(text) {
  const wanted = norm(text);
  if (wanted === "") return null;
  return (
    CITIES.find((city) =>
      city.names.some(
        (name) =>
          name === wanted ||
          (name.length >= 4 &&
            wanted.length >= 4 &&
            (wanted.startsWith(name) || name.startsWith(wanted)))
      )
    ) || null
  );
}

/** Canonical English city key ("haifa" for "חיפה"), or null when unknown. */
export function canonicalCity(text) {
  return findCity(text)?.canonical ?? null;
}

/** District key for a city name in either language, or null when unknown. */
export function districtOfCity(text) {
  return findCity(text)?.district ?? null;
}
