import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  installFetchMock,
  analysisFixture,
  matchmakerFixture,
} from "./testUtils";
import {
  runUserRequestAnalyzer,
  runMatchmakerAgent,
  runEthicalGuardianAgent,
  isUnsupportedQuestion,
} from "../lib/agents";

beforeEach(() => {
  process.env.LLMOD_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const candidates = [
  {
    id: "t1",
    score: 0.9,
    name: "Dana K.",
    location: "Haifa",
    neighborhood: "Carmel",
    price: 250,
    gender: "female",
    specialties: ["anxiety"],
    treatmentApproaches: ["CBT"],
    description: "Licensed therapist.",
    rating: 4.8,
    reviewCount: 24,
  },
];

describe("UserRequestAnalyzer intent strength", () => {
  it('treats "prefer" as soft but an "up to" budget as hard, dropping unsupported fields', async () => {
    installFetchMock({
      analyzer: analysisFixture({
        action: "search",
        maximumBudget: 350,
        languagePreference: "English",
        therapistGenderPreference: "female",
        onlinePreference: true,
        hardConstraints: [
          "maximumBudget",
          "languagePreference",
          "therapistGenderPreference",
          "onlinePreference",
        ],
      }),
    });
    const { analysis } = await runUserRequestAnalyzer(
      "I prefer an English-speaking female therapist, online, up to 350 NIS per session."
    );
    expect(analysis.hardConstraints).toEqual(["maximumBudget"]);
    expect(analysis.softPreferences).toEqual(["therapistGenderPreference"]);
    // Unsupported dataset fields never survive validation.
    expect(analysis).not.toHaveProperty("languagePreference");
    expect(analysis).not.toHaveProperty("onlinePreference");
  });

  it("never asks about online availability or language, in any supported language", async () => {
    const { chatCalls } = installFetchMock({
      analyzer: analysisFixture({
        action: "ask_questions",
        questions: [
          "Which city or area would be convenient for you?",
          "Would you prefer online or in-person sessions?",
          "What language would you like to speak in therapy?",
          "האם תרצה טיפול אונליין או פרונטלי?",
          "באיזו שפה נוח לך לדבר?",
        ],
        acknowledgment: "Thanks for sharing.",
        skipNote: "You may skip any question.",
      }),
    });
    const { analysis } = await runUserRequestAnalyzer("hi");
    expect(analysis.questions).toEqual([
      "Which city or area would be convenient for you?",
    ]);
    // The system prompt itself forbids these fields and no longer defines them.
    const systemPrompt = chatCalls[0].body.messages[0].content;
    expect(systemPrompt).toMatch(/NEVER ask about language, online sessions/i);
    expect(systemPrompt).not.toMatch(/"languagePreference"|"onlinePreference"/);
  });

  it("falls back to search when every proposed question is unsupported", async () => {
    installFetchMock({
      analyzer: analysisFixture({
        action: "ask_questions",
        questions: ["Do you prefer online sessions?", "What language do you prefer?"],
      }),
    });
    const { analysis } = await runUserRequestAnalyzer("hi");
    expect(analysis.questions).toEqual([]);
    expect(analysis.action).toBe("search");
  });

  it("filters unsupported topics from missing-information lists", async () => {
    installFetchMock({
      analyzer: analysisFixture({
        action: "ask_questions",
        questions: ["What is your maximum budget per session?"],
        missingHighImpactInformation: [
          "maximum budget",
          "online or in-person preference",
          "preferred language",
        ],
      }),
    });
    const { analysis } = await runUserRequestAnalyzer("hi");
    expect(analysis.missingHighImpactInformation).toEqual(["maximum budget"]);
  });

  it("detects unsupported question topics deterministically", () => {
    expect(isUnsupportedQuestion("Do you prefer online or in-person sessions?")).toBe(true);
    expect(isUnsupportedQuestion("Would remote video sessions work for you?")).toBe(true);
    expect(isUnsupportedQuestion("What language do you prefer?")).toBe(true);
    expect(isUnsupportedQuestion("Are you looking for an English-speaking therapist?")).toBe(true);
    expect(isUnsupportedQuestion("האם נוח לך טיפול בזום?")).toBe(true);
    expect(isUnsupportedQuestion("Which city or area suits you best?")).toBe(false);
    expect(isUnsupportedQuestion("Would you feel more comfortable with a female or male therapist?")).toBe(false);
    expect(isUnsupportedQuestion("What is your maximum budget per session?")).toBe(false);
  });

  it('preserves an explicit "must" requirement as hard', async () => {
    installFetchMock({
      analyzer: analysisFixture({
        action: "search",
        therapistGenderPreference: "female",
        hardConstraints: [],
        softPreferences: ["therapistGenderPreference"],
      }),
    });
    const { analysis } = await runUserRequestAnalyzer(
      "The therapist must be female."
    );
    expect(analysis.hardConstraints).toContain(
      "therapistGenderPreference"
    );
    expect(analysis.softPreferences).not.toContain(
      "therapistGenderPreference"
    );
  });
});

describe("MatchmakerAgent grounding", () => {
  it("drops recommendations for therapists Pinecone never returned", async () => {
    const output = matchmakerFixture(["t1", "fake-999"], "message");
    installFetchMock({ matchmaker: output });

    const { result } = await runMatchmakerAgent({
      userPrompt: "anxious",
      analysis: analysisFixture(),
      candidates,
    });

    expect(result.recommendations.map((r) => r.id)).toEqual(["t1"]);
    // Name and profile come from the retrieved candidate, never the model.
    expect(result.recommendations[0].name).toBe("Dana K.");
    expect(result.recommendations[0].profile.price).toBe(250);
  });

  it("caps recommendations at three", async () => {
    const many = [
      { ...candidates[0], id: "t1" },
      { ...candidates[0], id: "t2" },
      { ...candidates[0], id: "t3" },
      { ...candidates[0], id: "t4" },
    ];
    installFetchMock({
      matchmaker: matchmakerFixture(["t1", "t2", "t3", "t4"], "msg"),
    });
    const { result } = await runMatchmakerAgent({
      userPrompt: "anxious",
      analysis: analysisFixture(),
      candidates: many,
    });
    expect(result.recommendations).toHaveLength(3);
  });

  it("separates therapist candidates from Matchmaker knowledge", async () => {
    const { chatCalls } = installFetchMock({
      matchmaker: matchmakerFixture(["t1"], "msg"),
    });
    await runMatchmakerAgent({
      userPrompt: "anxious",
      analysis: analysisFixture(),
      candidates,
      matchmakerKnowledge: [
        {
          id: "article-1",
          text: "General CBT reference.",
          sourceFile: "therapy.txt",
          score: 0.8,
          agentTargets: ["Matchmaker Agent"],
        },
      ],
      unverifiedPreferences: [
        {
          field: "therapistGenderPreference",
          label: "therapist gender",
          requestedValue: "female",
          status: "unverified",
        },
      ],
    });
    const sent = JSON.parse(chatCalls[0].body.messages[1].content);
    expect(sent.therapist_candidates[0].id).toBe("t1");
    expect(sent.matchmaker_knowledge).toEqual([
      {
        text: "General CBT reference.",
        source_file: "therapy.txt",
        score: 0.8,
      },
    ]);
    expect(sent.therapist_candidates.map((profile) => profile.id)).not.toContain(
      "article-1"
    );
    expect(sent.unverified_preferences[0].field).toBe(
      "therapistGenderPreference"
    );
    expect(chatCalls[0].body.messages[0].content).toMatch(
      /never invent.*language.*online availability/i
    );
  });
});

describe("EthicalGuardianAgent validation", () => {
  it("rejects an invalid decision value (repair path exercised)", async () => {
    installFetchMock({
      guardian: { decision: "maybe", issues: [], safeResponse: "x" },
      repair: { decision: "approve", issues: [], safeResponse: "x" },
    });
    const { review, steps } = await runEthicalGuardianAgent({
      userPrompt: "anxious",
      analysis: analysisFixture(),
      profiles: candidates,
      draftResponse: "Draft.",
    });
    expect(review.decision).toBe("approve");
    // approve always returns the original draft, enforced in code.
    expect(review.safeResponse).toBe("Draft.");
    expect(steps).toHaveLength(2);
  });

  it("receives separate Guardian references and targeted knowledge", async () => {
    const { chatCalls } = installFetchMock({
      guardian: { decision: "approve", issues: [], safeResponse: "Draft." },
    });
    await runEthicalGuardianAgent({
      userPrompt: "anxious",
      analysis: analysisFixture(),
      profiles: candidates,
      draftResponse: "Draft.",
      guardianReferenceData: [{ diagnosis: "Anxiety", therapyType: "CBT" }],
      guardianKnowledge: [
        {
          id: "safety-1",
          text: "Do not guarantee outcomes.",
          sourceFile: "safety.txt",
          score: 0.9,
          agentTargets: ["Ethical Guardian Agent"],
        },
      ],
      unverifiedPreferences: [
        {
          field: "location",
          label: "location",
          requestedValue: "Haifa",
          status: "unverified",
        },
      ],
    });
    const sent = JSON.parse(chatCalls[0].body.messages[1].content);
    expect(sent.guardian_reference_data[0].diagnosis).toBe("Anxiety");
    expect(sent.guardian_knowledge[0].source_file).toBe("safety.txt");
    expect(sent.unverified_preferences[0].field).toBe("location");
    expect(sent.therapist_profiles[0].id).toBe("t1");
    expect(chatCalls[0].body.messages[0].content).toMatch(
      /never produce a definitive diagnosis/i
    );
  });
});
