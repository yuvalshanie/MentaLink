import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  installFetchMock,
  analysisFixture,
  supabaseRow,
  matchmakerFixture,
  guardianFixture,
} from "./testUtils";

const { queryMock, supabaseState, fromMock, limitMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  supabaseState: {
    tables: {
      therapist_data: { rows: [], error: null },
      mental_health_diagnosis_treatment: { rows: [], error: null },
    },
  },
  fromMock: vi.fn(),
  limitMock: vi.fn(),
}));

vi.mock("../lib/pinecone", () => {
  const index = { query: (...args) => queryMock(...args) };
  index.namespace = () => index;
  return { getPinecone: () => ({ index: () => index }) };
});

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    from: (table) => {
      fromMock(table);
      return {
        select: () => ({
          limit: (limit) => {
            limitMock(table, limit);
            const state = supabaseState.tables[table] || { rows: [], error: null };
            return Promise.resolve({ data: state.rows, error: state.error });
          },
        }),
      };
    },
  }),
}));

import { runMentaLinkAgent } from "../lib/orchestrator";

function knowledge(
  id,
  targets,
  text = `knowledge ${id} — general reference content used in orchestrator tests.`
) {
  return {
    id,
    score: 0.85,
    metadata: {
      agent_targets: targets,
      source_file: `${id}.txt`,
      text,
    },
  };
}

function installKnowledgeResults() {
  queryMock.mockImplementation(async () => ({
    matches: [
      knowledge("match-only", ["Matchmaker Agent"]),
      knowledge("guardian-only", ["Ethical Guardian Agent"]),
      knowledge("shared", ["Matchmaker Agent", "Ethical Guardian Agent"]),
    ],
  }));
}

beforeEach(() => {
  process.env.LLMOD_API_KEY = "test-key";
  queryMock.mockReset();
  fromMock.mockReset();
  limitMock.mockReset();
  supabaseState.tables.therapist_data = { rows: [], error: null };
  supabaseState.tables.mental_health_diagnosis_treatment = {
    rows: [],
    error: null,
  };
});

afterEach(() => vi.unstubAllGlobals());

describe("runMentaLinkAgent input and bounded conversation flow", () => {
  it("rejects empty input", async () => {
    await expect(runMentaLinkAgent(" ")).rejects.toThrow(/non-empty/);
  });

  it("does not query Pinecone or Supabase on a clarification turn", async () => {
    const { fetchMock } = installFetchMock({
      analyzer: analysisFixture({
        action: "ask_questions",
        questions: ["Which city or area would be convenient for you?"],
        acknowledgment: "I can help with that.",
        skipNote: "You may skip this question.",
      }),
    });
    const { response, steps } = await runMentaLinkAgent("help me find someone");
    expect(response).toMatch(/city or area/);
    expect(steps.map((step) => step.module)).toEqual(["UserRequestAnalyzer"]);
    expect(queryMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/embeddings"))
    ).toHaveLength(0);
  });

  it("strips online/language questions before they reach the user", async () => {
    installFetchMock({
      analyzer: analysisFixture({
        action: "ask_questions",
        questions: [
          "Which city or area would be convenient for you?",
          "Would you prefer online or in-person sessions?",
          "What language would you like to speak in therapy?",
        ],
        acknowledgment: "Thanks for sharing.",
        skipNote: "You may skip any question.",
      }),
    });
    const { response, steps } = await runMentaLinkAgent("hi");
    expect(response).toMatch(/city or area/);
    expect(response).not.toMatch(/online|in-person|language/i);
    expect(steps.map((step) => step.module)).toEqual(["UserRequestAnalyzer"]);
    expect(queryMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("caps a clarification round at three questions", async () => {
    installFetchMock({
      analyzer: analysisFixture({
        action: "ask_questions",
        questions: [
          "What would you like help with?",
          "What do you hope will improve?",
          "Which city or area is convenient?",
          "What is your maximum budget per session?",
          "Would you prefer a female or male therapist?",
        ],
      }),
    });
    const { response } = await runMentaLinkAgent("hi");
    const numbered = response.match(/^\s*\d+[.)]\s/gm) || [];
    expect(numbered).toHaveLength(3);
  });

  it("stops clarifying after two rounds even if the analyzer wants more", async () => {
    installKnowledgeResults();
    supabaseState.tables.therapist_data.rows = [supabaseRow("t1")];
    const { chatCalls } = installFetchMock({
      analyzer: analysisFixture({
        action: "ask_questions",
        questions: ["Which city or area is convenient?"],
      }),
      matchmaker: matchmakerFixture(["t1"], "draft"),
      guardian: guardianFixture("approve", "draft"),
    });
    const conversation = JSON.stringify({
      mlConversation: 1,
      turns: [
        { role: "user", text: "I need help." },
        { role: "assistant", kind: "questions", text: "1. What would you like help with?\n2. Which city or area?" },
        { role: "user", text: "Anxiety. Haifa maybe." },
        { role: "assistant", kind: "questions", text: "1. What is your maximum budget per session?" },
        { role: "user", text: "Not sure." },
      ],
    });
    const { steps } = await runMentaLinkAgent(conversation);
    // Deterministic limit: two clarification rounds used, so this turn must
    // proceed to search instead of asking again.
    expect(steps.map((step) => step.module)).toEqual([
      "UserRequestAnalyzer",
      "MatchmakerAgent",
      "EthicalGuardianAgent",
    ]);
    expect(chatCalls.map((call) => call.agent)).toEqual([
      "analyzer",
      "matchmaker",
      "guardian",
    ]);
  });

  it("uses the full clarified conversation on the following search turn", async () => {
    installKnowledgeResults();
    supabaseState.tables.therapist_data.rows = [supabaseRow("t1")];
    const { chatCalls } = installFetchMock({
      analyzer: analysisFixture({ action: "search", location: "Haifa" }),
      matchmaker: matchmakerFixture(["t1"], "draft"),
      guardian: guardianFixture("approve", "draft"),
    });
    const conversation = JSON.stringify({
      mlConversation: 1,
      turns: [
        { role: "user", text: "I need help with anxiety." },
        {
          role: "assistant",
          kind: "questions",
          text: "1. Which city or area would be convenient for you?",
        },
        { role: "user", text: "Haifa, please." },
      ],
    });
    await runMentaLinkAgent(conversation);
    const analyzerPrompt = chatCalls.find((call) => call.agent === "analyzer")
      .body.messages[1].content;
    expect(analyzerPrompt).toMatch(/I need help with anxiety/);
    expect(analyzerPrompt).toMatch(/Haifa, please/);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("answers explicit English self-harm intent before ANY external call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { response, steps } = await runMentaLinkAgent("I want to kill myself.");
    // Deterministic template: compassionate, non-diagnostic, safety-focused.
    expect(response).toMatch(/not an emergency or crisis service/i);
    expect(response).toMatch(/local emergency services/i);
    expect(response).toMatch(/someone you trust/i);
    // Zero LLM/embedding calls, zero Pinecone, zero Supabase, empty steps.
    expect(steps).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("answers explicit Hebrew self-harm intent in Hebrew before ANY external call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { response, steps } = await runMentaLinkAgent("אני רוצה להתאבד.");
    expect(response).toMatch(/שירות חירום/);
    expect(response).toMatch(/שירותי החירום/);
    expect(steps).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("uses the deterministic template when only the analyzer detects crisis", async () => {
    // Wording that the local detector does not catch, but the model flags.
    installFetchMock({
      analyzer: analysisFixture({ crisisRisk: true, action: "crisis" }),
    });
    const { response, steps } = await runMentaLinkAgent(
      "Everything is dark and I might do something to myself soon"
    );
    expect(response).toMatch(/not an emergency or crisis service/i);
    // Analyzer ran; no Guardian call is required for the crisis template.
    expect(steps.map((step) => step.module)).toEqual(["UserRequestAnalyzer"]);
    expect(queryMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("does not force a crisis response on educational suicide-prevention questions", async () => {
    installKnowledgeResults();
    supabaseState.tables.therapist_data.rows = [supabaseRow("t1")];
    // Analyzer over-triggers crisis on the word "suicide"; the deterministic
    // educational backstop suppresses it and the normal flow continues.
    installFetchMock({
      analyzer: analysisFixture({ crisisRisk: true, action: "crisis" }),
      matchmaker: matchmakerFixture(["t1"], "draft"),
      guardian: guardianFixture("approve", "draft"),
    });
    const { response, steps } = await runMentaLinkAgent(
      "I am researching how therapists respond to suicide prevention questions."
    );
    expect(response).not.toMatch(/not an emergency or crisis service/i);
    expect(steps.map((step) => step.module)).toEqual([
      "UserRequestAnalyzer",
      "MatchmakerAgent",
      "EthicalGuardianAgent",
    ]);
  });

  it("routes an Azure content-filter rejection of self-harm content to the crisis template", async () => {
    const azureBody =
      '{"error":{"code":"content_filter","message":"The response was filtered due to the prompt triggering Azure OpenAI content management policy."}}';
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => azureBody,
    }));
    vi.stubGlobal("fetch", fetchMock);
    // Passes the local gate (no explicit phrase) but mentions death.
    const { response, steps } = await runMentaLinkAgent(
      "Life feels pointless and I keep thinking about death"
    );
    expect(response).toMatch(/not an emergency or crisis service/i);
    expect(steps).toEqual([]);
    // Raw provider internals never reach the user.
    expect(response).not.toMatch(/azure|content_filter|filtered|400/i);
    expect(queryMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns a neutral safe message for a content-filter rejection without self-harm content", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => '{"error":{"code":"content_filter","message":"filtered"}}',
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { response, steps } = await runMentaLinkAgent(
      "Please review this graphic violent story I wrote about a war"
    );
    expect(response).toMatch(/not able to process that message safely/i);
    expect(response).not.toMatch(/azure|content_filter|filtered|crisis|emergency/i);
    expect(steps).toEqual([]);
  });

  it("keeps non-content-policy provider failures as sanitized errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "azure backend exploded with secret details",
      }))
    );
    await expect(runMentaLinkAgent("I feel anxious")).rejects.toSatisfy(
      (err) =>
        /language-model service returned an error/.test(err.message) &&
        !/azure|secret/.test(err.message)
    );
  });
});

describe("agent-specific data flow", () => {
  it("returns grounded live-schema candidates without any language/online fields", async () => {
    installKnowledgeResults();
    supabaseState.tables.therapist_data.rows = [
      {
        therapist_id: 101,
        name: "Dana Levi",
        city: "Haifa",
        neighborhood: "Carmel",
        price_nis: 320,
        gender: "female",
        therapy_type: "CBT",
        rating: 4.8,
        review_count: 24,
      },
      {
        therapist_id: 102,
        name: "Noa Cohen",
        city: "Tel Aviv",
        neighborhood: "Center",
        price_nis: 380,
        gender: "female",
        therapy_type: "Psychodynamic",
        rating: 4.6,
        review_count: 10,
      },
    ];
    const draft =
      "Dana Levi in Haifa (Carmel) charges 320 NIS and offers CBT. Rating: 4.8 from 24 reviews.";
    const { chatCalls } = installFetchMock({
      analyzer: analysisFixture({
        action: "search",
        maximumBudget: 350,
        location: "Haifa",
        therapistGenderPreference: "female",
        hardConstraints: ["maximumBudget"],
        softPreferences: ["location", "therapistGenderPreference"],
      }),
      matchmaker: matchmakerFixture(["101"], draft),
      guardian: guardianFixture("approve", draft),
    });

    const { response, steps } = await runMentaLinkAgent(
      "I feel anxious before exams. I am looking for a female therapist in Haifa, with a maximum price of 350 NIS per session."
    );

    const matchmakerPrompt = JSON.parse(
      chatCalls.find((call) => call.agent === "matchmaker").body.messages[1]
        .content
    );
    expect(matchmakerPrompt.analysis.hardConstraints).toEqual([
      "maximumBudget",
    ]);
    expect(matchmakerPrompt.analysis.softPreferences).toEqual([
      "location",
      "therapistGenderPreference",
    ]);
    // Budget is hard: the 380 NIS candidate never reaches the Matchmaker.
    expect(matchmakerPrompt.therapist_candidates).toHaveLength(1);
    expect(matchmakerPrompt.therapist_candidates[0]).toMatchObject({
      id: "101",
      name: "Dana Levi",
      location: "Haifa",
      neighborhood: "Carmel",
      price: 320,
      gender: "female",
      treatmentApproaches: ["CBT"],
      rating: 4.8,
      reviewCount: 24,
    });
    // Unsupported fields are gone entirely, not sent as empty values.
    expect(matchmakerPrompt.therapist_candidates[0]).not.toHaveProperty(
      "languages"
    );
    expect(matchmakerPrompt.therapist_candidates[0]).not.toHaveProperty(
      "online"
    );
    expect(matchmakerPrompt.analysis).not.toHaveProperty("languagePreference");
    expect(matchmakerPrompt.analysis).not.toHaveProperty("onlinePreference");
    expect(matchmakerPrompt.unverified_preferences).toEqual([]);

    const guardianPrompt = JSON.parse(
      chatCalls.find((call) => call.agent === "guardian").body.messages[1]
        .content
    );
    expect(guardianPrompt.unverified_preferences).toEqual([]);
    expect(response).toContain("Dana Levi");
    // No unverified-limitation note about language/online anywhere.
    expect(response).toBe(draft);
    expect(response).not.toMatch(/language|online/i);
    expect(steps.map((step) => step.module)).toEqual([
      "UserRequestAnalyzer",
      "MatchmakerAgent",
      "EthicalGuardianAgent",
    ]);
  });

  it("never mentions language or online even when the user asked about them", async () => {
    installKnowledgeResults();
    supabaseState.tables.therapist_data.rows = [
      {
        therapist_id: 101,
        name: "Dana Levi",
        city: "Haifa",
        neighborhood: "Carmel",
        price_nis: 320,
        gender: "female",
        therapy_type: "CBT",
        rating: 4.8,
        review_count: 24,
      },
    ];
    const draft = "Dana Levi in Haifa charges 320 NIS and offers CBT.";
    const { chatCalls } = installFetchMock({
      analyzer: analysisFixture({
        action: "search",
        maximumBudget: 350,
        therapistGenderPreference: "female",
        hardConstraints: ["maximumBudget"],
        softPreferences: ["therapistGenderPreference"],
      }),
      matchmaker: matchmakerFixture(["101"], draft),
      guardian: guardianFixture("approve", draft),
    });
    const { response } = await runMentaLinkAgent(
      "I prefer an English-speaking female therapist, online, up to 350 NIS per session."
    );
    // The analysis carries no language/online fields, so nothing marks them
    // unverified and no note is appended to the Guardian-approved draft.
    const matchmakerPrompt = JSON.parse(
      chatCalls.find((call) => call.agent === "matchmaker").body.messages[1]
        .content
    );
    expect(matchmakerPrompt.unverified_preferences).toEqual([]);
    expect(response).toBe(draft);
  });

  it("keeps structured therapist data separate from routed knowledge", async () => {
    installKnowledgeResults();
    supabaseState.tables.therapist_data.rows = [
      supabaseRow("t1", { name: "Dana", location: "Haifa" }),
      supabaseRow("t2", { name: "Noa", location: "Tel Aviv" }),
    ];
    supabaseState.tables.mental_health_diagnosis_treatment.rows = [
      {
        "Patient ID": "must-not-be-sent",
        Diagnosis: "Anxiety",
        "Therapy Type": "CBT",
        Outcome: "Improved",
      },
    ];
    const message = "Grounded therapist suggestions.";
    const { chatCalls } = installFetchMock({
      embedding: [0.1, 0.2],
      analyzer: analysisFixture(),
      matchmaker: matchmakerFixture(["t1", "t2"], message),
      guardian: guardianFixture("approve", message),
    });

    const { response, steps } = await runMentaLinkAgent("I feel anxious");
    expect(response).toBe(message);
    expect(steps.map((step) => step.module)).toEqual([
      "UserRequestAnalyzer",
      "MatchmakerAgent",
      "EthicalGuardianAgent",
    ]);
    expect(fromMock.mock.calls.map(([table]) => table)).toEqual([
      "therapist_data",
      "mental_health_diagnosis_treatment",
    ]);

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[0][0]).toMatchObject({
      includeMetadata: true,
      filter: { agent_targets: { $in: ["Matchmaker Agent"] } },
    });
    expect(queryMock.mock.calls[1][0]).toMatchObject({
      includeMetadata: true,
      filter: { agent_targets: { $in: ["Ethical Guardian Agent"] } },
    });

    const matchmakerCall = chatCalls.find((call) => call.agent === "matchmaker");
    const matchmakerPrompt = JSON.parse(matchmakerCall.body.messages[1].content);
    expect(matchmakerPrompt.therapist_candidates.map((row) => row.id)).toEqual([
      "t1",
      "t2",
    ]);
    expect(matchmakerPrompt.matchmaker_knowledge.map((row) => row.text)).toEqual([
      "knowledge match-only — general reference content used in orchestrator tests.",
      "knowledge shared — general reference content used in orchestrator tests.",
    ]);
    expect(matchmakerPrompt).not.toHaveProperty("guardian_reference_data");
    expect(matchmakerPrompt.therapist_candidates.map((row) => row.id)).not.toContain(
      "match-only"
    );

    const guardianCall = chatCalls.find((call) => call.agent === "guardian");
    const guardianPrompt = JSON.parse(guardianCall.body.messages[1].content);
    expect(guardianPrompt.guardian_knowledge.map((row) => row.text)).toEqual([
      "knowledge guardian-only — general reference content used in orchestrator tests.",
      "knowledge shared — general reference content used in orchestrator tests.",
    ]);
    expect(guardianPrompt.guardian_reference_data[0].diagnosis).toBe("Anxiety");
    expect(guardianPrompt.guardian_reference_data[0]).not.toHaveProperty(
      "Patient ID"
    );
  });

  it("applies hard constraints to therapist_data profiles", async () => {
    installKnowledgeResults();
    supabaseState.tables.therapist_data.rows = [
      supabaseRow("t1", { location: "Haifa" }),
      supabaseRow("t2", { location: "Tel Aviv" }),
    ];
    const { chatCalls } = installFetchMock({
      analyzer: analysisFixture({
        location: "Haifa",
        hardConstraints: ["location"],
      }),
      matchmaker: matchmakerFixture(["t1"]),
      guardian: guardianFixture("approve", "ok"),
    });
    await runMentaLinkAgent("Haifa is required");
    const call = chatCalls.find((entry) => entry.agent === "matchmaker");
    const prompt = JSON.parse(call.body.messages[1].content);
    expect(prompt.therapist_candidates.map((row) => row.id)).toEqual(["t1"]);
  });

  it("resolves a region request to district cities (north -> Haifa)", async () => {
    installKnowledgeResults();
    supabaseState.tables.therapist_data.rows = [
      supabaseRow("t1", { location: "Haifa" }),
      supabaseRow("t2", { location: "Tel Aviv" }),
      supabaseRow("t3", { location: "Jerusalem" }),
    ];
    const { chatCalls } = installFetchMock({
      analyzer: analysisFixture({
        action: "search",
        location: "the north",
        hardConstraints: ["location"],
      }),
      matchmaker: matchmakerFixture(["t1"]),
      guardian: guardianFixture("approve", "ok"),
    });
    await runMentaLinkAgent("I must find someone in the north");
    const call = chatCalls.find((entry) => entry.agent === "matchmaker");
    const prompt = JSON.parse(call.body.messages[1].content);
    expect(prompt.therapist_candidates.map((row) => row.id)).toEqual(["t1"]);
    // The region value itself is passed through, not rewritten to a city.
    expect(prompt.analysis.location).toBe("the north");
  });
});

describe("Guardian handoff and decision control", () => {
  const rows = [
    supabaseRow("t1", { name: "Dana", location: "Haifa" }),
    supabaseRow("t2", { name: "Noa", location: "Tel Aviv" }),
  ];

  it("passes the exact Matchmaker draft and candidate set to the Guardian", async () => {
    installKnowledgeResults();
    supabaseState.tables.therapist_data.rows = rows;
    const draft = "Draft with therapist details for review.";
    const { chatCalls } = installFetchMock({
      analyzer: analysisFixture(),
      matchmaker: matchmakerFixture(["t1", "t2"], draft),
      guardian: guardianFixture("approve", draft),
    });
    await runMentaLinkAgent("anxious");

    const matchmakerPrompt = JSON.parse(
      chatCalls.find((call) => call.agent === "matchmaker").body.messages[1]
        .content
    );
    const guardianPrompt = JSON.parse(
      chatCalls.find((call) => call.agent === "guardian").body.messages[1]
        .content
    );
    // Verbatim draft, not a summary or rewrite.
    expect(guardianPrompt.draft_response).toBe(draft);
    // The identical candidate set the Matchmaker ranked.
    expect(guardianPrompt.therapist_profiles.map((p) => p.id)).toEqual(
      matchmakerPrompt.therapist_candidates.map((p) => p.id)
    );
    // Original user request and structured analysis both present.
    expect(guardianPrompt.user_request).toBe(matchmakerPrompt.user_request);
    expect(guardianPrompt.analysis).toEqual(matchmakerPrompt.analysis);
  });

  it("returns the Guardian's corrected safeResponse on revise, never the draft", async () => {
    installKnowledgeResults();
    supabaseState.tables.therapist_data.rows = rows;
    const draft = "Dana is certified in EMDR and guarantees recovery.";
    const corrected =
      "Dana may be worth considering based on her listed profile details.";
    installFetchMock({
      analyzer: analysisFixture(),
      matchmaker: matchmakerFixture(["t1"], draft),
      guardian: guardianFixture("revise", corrected, [
        "invented qualification",
        "guaranteed outcome",
      ]),
    });
    const { response } = await runMentaLinkAgent("anxious");
    expect(response).toBe(corrected);
    expect(response).not.toContain("guarantees recovery");
  });

  it("hides the Matchmaker draft entirely on block", async () => {
    installKnowledgeResults();
    supabaseState.tables.therapist_data.rows = rows;
    const draft = "Unsafe draft that must never reach the user.";
    const safety =
      "We cannot safely share recommendations for this request. Please consider reaching out to a mental-health professional directly.";
    installFetchMock({
      analyzer: analysisFixture(),
      matchmaker: matchmakerFixture(["t1"], draft),
      guardian: guardianFixture("block", safety, ["unsafe content"]),
    });
    const { response, steps } = await runMentaLinkAgent("anxious");
    expect(response).toBe(safety);
    expect(response).not.toContain("Unsafe draft");
    // Guardian still ran exactly once — no retry loop.
    expect(
      steps.filter((step) => step.module === "EthicalGuardianAgent")
    ).toHaveLength(1);
  });

  it("runs exactly one Guardian review cycle", async () => {
    installKnowledgeResults();
    supabaseState.tables.therapist_data.rows = rows;
    const { chatCalls } = installFetchMock({
      analyzer: analysisFixture(),
      matchmaker: matchmakerFixture(["t1"], "draft"),
      guardian: guardianFixture("revise", "corrected"),
    });
    await runMentaLinkAgent("anxious");
    expect(
      chatCalls.filter((call) => call.agent === "guardian")
    ).toHaveLength(1);
    expect(
      chatCalls.filter((call) => call.agent === "matchmaker")
    ).toHaveLength(1);
  });
});

describe("independent retrieval failures", () => {
  it("continues safely when both Pinecone knowledge queries fail", async () => {
    queryMock.mockRejectedValue(new Error("pinecone unavailable"));
    supabaseState.tables.therapist_data.rows = [supabaseRow("t1")];
    const { chatCalls } = installFetchMock({
      analyzer: analysisFixture(),
      matchmaker: matchmakerFixture(["t1"], "draft"),
      guardian: guardianFixture("approve", "draft"),
    });
    const { response } = await runMentaLinkAgent("anxious");
    expect(response).toBe("draft");
    const matchmakerPrompt = JSON.parse(
      chatCalls.find((call) => call.agent === "matchmaker").body.messages[1].content
    );
    const guardianPrompt = JSON.parse(
      chatCalls.find((call) => call.agent === "guardian").body.messages[1].content
    );
    expect(matchmakerPrompt.matchmaker_knowledge).toEqual([]);
    expect(guardianPrompt.guardian_knowledge).toEqual([]);
  });

  it("does not invent recommendations when therapist_data fails", async () => {
    installKnowledgeResults();
    supabaseState.tables.therapist_data.error = { message: "unavailable" };
    const { chatCalls } = installFetchMock({ analyzer: analysisFixture() });
    const { response, steps } = await runMentaLinkAgent("anxious");
    expect(response).toMatch(/could not access the therapist directory/i);
    expect(steps.map((step) => step.module)).toEqual(["UserRequestAnalyzer"]);
    expect(chatCalls.map((call) => call.agent)).toEqual(["analyzer"]);
  });

  it("still runs the Guardian when its Supabase source fails", async () => {
    installKnowledgeResults();
    supabaseState.tables.therapist_data.rows = [supabaseRow("t1")];
    supabaseState.tables.mental_health_diagnosis_treatment.error = {
      message: "unavailable",
    };
    const { chatCalls } = installFetchMock({
      analyzer: analysisFixture(),
      matchmaker: matchmakerFixture(["t1"], "draft"),
      guardian: guardianFixture("approve", "draft"),
    });
    await runMentaLinkAgent("anxious");
    const guardianPrompt = JSON.parse(
      chatCalls.find((call) => call.agent === "guardian").body.messages[1].content
    );
    expect(guardianPrompt.guardian_reference_data).toEqual([]);
    expect(guardianPrompt.guardian_knowledge).toHaveLength(2);
  });

  it("returns an honest no-match response for an empty therapist_data table", async () => {
    installKnowledgeResults();
    installFetchMock({ analyzer: analysisFixture() });
    const { response, steps } = await runMentaLinkAgent("anxious");
    expect(response).toMatch(/could not find any therapists/i);
    expect(steps.map((step) => step.module)).toEqual(["UserRequestAnalyzer"]);
  });
});
