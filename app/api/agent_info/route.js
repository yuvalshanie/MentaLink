import { NextResponse } from "next/server";

const EXAMPLE_PROMPT =
  "I've been feeling really anxious lately and it's hard for me to leave the house. I'm looking for a female therapist in Haifa, up to 300 per session.";

const EXAMPLE_ANALYSIS = {
  action: "search",
  concerns: ["feeling really anxious", "hard to leave the house"],
  userGoals: ["feel less anxious day to day"],
  location: "Haifa",
  maximumBudget: 300,
  therapistGenderPreference: "female",
  therapyStylePreference: null,
  treatmentPreferences: [],
  hardConstraints: ["maximumBudget"],
  softPreferences: ["location", "therapistGenderPreference"],
  missingHighImpactInformation: [],
  crisisRisk: false,
};

const EXAMPLE_RESPONSE =
  "Thank you for sharing this — anxiety that makes it hard to leave the house can feel very isolating, and looking for support is a meaningful first step. Based on what you described, here are two therapists who may be worth considering:\n\n" +
  "1. Dana K. — a therapist based in Haifa (Carmel) whose therapy type is CBT, charging 280 per session, with a 4.8 rating from 24 reviews. A structured, practical approach like CBT is often discussed for anxiety-related struggles, so she may be relevant to what you described. Matched: Haifa, female, within budget.\n\n" +
  "2. Michal A. — a therapist based in Haifa (Hadar) whose therapy type is psychodynamic therapy, charging 260 per session, with a 4.6 rating from 18 reviews. She may fit if you would rather explore things in an open, conversational way. Matched: Haifa, female, within budget.\n\n" +
  "These are suggestions to explore, not a guarantee of fit — a first conversation is the best way to see whether a therapist feels right for you.\n\n" +
  "Please note: MentaLink only helps you discover potentially relevant therapist options. It does not diagnose, does not replace professional mental-health care, and cannot guarantee that a particular therapist will be right for you.";

const EXAMPLE_STEPS = [
  {
    module: "UserRequestAnalyzer",
    prompt: {
      System_prompt:
        "You analyze a short conversation between MentaLink and a person seeking a therapist. Return ONLY a JSON object: {\"action\":...,\"concerns\":[],...}. The therapist directory contains only name, city, neighborhood, price, gender, therapy type, and rating — never ask about or extract language or online/in-person preferences. (concise instructions omitted here for brevity)",
      User_prompt: EXAMPLE_PROMPT,
    },
    response: EXAMPLE_ANALYSIS,
  },
  {
    module: "MatchmakerAgent",
    prompt: {
      System_prompt:
        "You rank therapist candidates for a person seeking support. Use ONLY the candidate data given — never invent details, never diagnose, never guarantee outcomes. Return ONLY a JSON object with recommendations and userMessage. (concise instructions omitted here for brevity)",
      User_prompt:
        JSON.stringify({
          user_request: EXAMPLE_PROMPT,
          analysis: EXAMPLE_ANALYSIS,
          therapist_candidates:
            "<bounded therapist profiles fetched directly from Supabase therapist_data>",
          matchmaker_knowledge: [
            {
              text: "<Matchmaker-targeted Pinecone knowledge chunk>",
              source_file: "<source file>",
              score: 0.0,
            },
          ],
        }),
    },
    response: {
      recommendations: [
        {
          id: "therapist-042",
          name: "Dana K.",
          whyRelevant:
            "Based in Haifa; therapy type CBT; 280 per session; 4.8 rating from 24 reviews.",
          matchedPreferences: ["location", "gender", "budget"],
          limitations: ["availability not listed in profile"],
          summary:
            "Haifa-based CBT therapist within budget with a high rating.",
        },
        {
          id: "therapist-108",
          name: "Michal A.",
          whyRelevant:
            "Based in Haifa; psychodynamic therapy; 260 per session; 4.6 rating from 18 reviews.",
          matchedPreferences: ["location", "gender", "budget"],
          limitations: [],
          summary:
            "Haifa-based psychodynamic therapist within budget.",
        },
      ],
      userMessage: EXAMPLE_RESPONSE,
    },
  },
  {
    module: "EthicalGuardianAgent",
    prompt: {
      System_prompt:
        "You are an ethical reviewer for a therapist-matching assistant. Review the draft for diagnosis, invented details, guarantees, stigmatizing language, constraint violations and crisis safety. Return ONLY {\"decision\":\"approve|revise|block\",\"issues\":[],\"safeResponse\":\"...\"}. (concise instructions omitted here for brevity)",
      User_prompt:
        JSON.stringify({
          user_request: EXAMPLE_PROMPT,
          analysis: EXAMPLE_ANALYSIS,
          therapist_profiles: "<therapist profiles used in the draft>",
          draft_response: "<MatchmakerAgent userMessage>",
          guardian_reference_data:
            "<bounded safety references from mental_health_diagnosis_treatment>",
          guardian_knowledge: [
            {
              text: "<Ethical-Guardian-targeted Pinecone knowledge chunk>",
              source_file: "<source file>",
              score: 0.0,
            },
          ],
        }),
    },
    response: {
      decision: "approve",
      issues: [],
      safeResponse: EXAMPLE_RESPONSE,
    },
  },
];

export async function GET() {
  return NextResponse.json({
    description:
      "MentaLink is a therapist discovery and matching tool. UserRequestAnalyzer creates a structured, non-diagnostic request analysis and asks at most two short clarification rounds about details the therapist directory can actually use (city/area, budget, therapist gender, therapy style). MatchmakerAgent receives authoritative therapist profiles only from Supabase therapist_data plus bounded Pinecone knowledge whose agent_targets contains 'Matchmaker Agent'. The knowledge can support therapy-style reasoning but is never treated as therapist data. EthicalGuardianAgent receives the same grounded therapist profiles, bounded structured safety references from Supabase mental_health_diagnosis_treatment, and Pinecone knowledge whose agent_targets contains 'Ethical Guardian Agent'. Shared Pinecone chunks may reach both agents; exclusive chunks are isolated. The Guardian reviews the draft and approves, revises once, or blocks it. MentaLink does not diagnose, replace professional care, handle emergencies, or guarantee fit or outcomes. Crisis requests bypass routine retrieval and matchmaking.",
    purpose:
      "Help first-time help-seekers find up to three potentially relevant therapists based on their own plain-language description, considering semantic relevance to their expressed struggles together with city/area, budget, therapist gender preference, and therapy-type preferences — with transparent, grounded explanations and an ethical safety review.",
    prompt_template: {
      template:
        "Describe in your own words what you are struggling with and what you are looking for in a therapist. You may include: your city or area, maximum budget per session, preferred therapist gender, and any therapy style you are interested in. Mark anything that is a must for you.\n\nExample: \"<what I'm going through>. I'm looking for a <gender> therapist in <city>, up to <budget> per session.\"",
    },
    prompt_examples: [
      {
        prompt: EXAMPLE_PROMPT,
        full_response: EXAMPLE_RESPONSE,
        steps: EXAMPLE_STEPS,
      },
    ],
  });
}
