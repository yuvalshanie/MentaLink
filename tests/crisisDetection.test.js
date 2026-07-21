import { describe, expect, it } from "vitest";
import {
  detectCrisis,
  mentionsSelfHarmTopic,
  isEducationalDiscussion,
  detectResponseLanguage,
} from "../lib/crisisDetection";

describe("detectCrisis — explicit English self-harm intent", () => {
  it.each([
    "I want to kill myself.",
    "I have PTSD and I want to kill myself",
    "Lately I keep thinking I should end my life",
    "I don't want to live anymore",
    "honestly i'd be better off dead",
    "I am ready to die",
    "I have been cutting myself",
    "I can't keep myself safe tonight",
    "I'm suicidal",
    "I've been having suicidal thoughts",
    "I want to commit suicide",
  ])("flags %j as high risk", (text) => {
    expect(detectCrisis(text)).toEqual({
      crisisRisk: true,
      level: "high",
      reason: "explicit_self_harm_intent",
    });
  });
});

describe("detectCrisis — explicit Hebrew self-harm intent", () => {
  it.each([
    "אני רוצה להתאבד.",
    "בא לי למות",
    "אני לא רוצה לחיות יותר",
    "אני פוגעת בעצמי",
    "יש לי מחשבות אובדניות",
    "אני רוצה לשים קץ לחיי",
    "עדיף שאמות",
    "אני לא יכולה לשמור על עצמי",
  ])("flags %j as high risk", (text) => {
    const result = detectCrisis(text);
    expect(result.crisisRisk).toBe(true);
    expect(result.level).toBe("high");
  });
});

describe("detectCrisis — non-crisis mental-health talk stays normal", () => {
  it.each([
    "hi",
    "I have PTSD and I am looking for a therapist",
    "I have been anxious since my exams.",
    "I feel depressed lately and want help",
    "Looking for a female therapist in Haifa up to 350 NIS",
    "מרגישה לחוצה מאוד לאחרונה ומחפשת מטפלת",
  ])("does not flag %j", (text) => {
    expect(detectCrisis(text).crisisRisk).toBe(false);
  });

  it.each([
    "I am writing about suicide prevention",
    "I am researching how therapists respond to suicide prevention questions.",
    "Writing my thesis on self-harm statistics among teens",
    "אני כותבת מאמר על מניעת התאבדות",
  ])("treats educational discussion %j as non-crisis", (text) => {
    expect(detectCrisis(text).crisisRisk).toBe(false);
  });

  it("still flags explicit personal intent even in an academic frame", () => {
    expect(
      detectCrisis("I am writing an essay but honestly I want to kill myself")
        .crisisRisk
    ).toBe(true);
  });
});

describe("isEducationalDiscussion (analyzer over-trigger backstop)", () => {
  it.each([
    "I am researching how therapists respond to suicide prevention questions.",
    "I am writing about suicide prevention",
    "Writing my thesis on self-harm statistics among teens",
    "אני כותבת מאמר על מניעת התאבדות",
  ])("recognizes educational framing %j", (text) => {
    expect(isEducationalDiscussion(text)).toBe(true);
  });

  it.each([
    "I want to kill myself",
    "I am researching suicide but honestly I want to die",
    "find me a therapist in Haifa",
    "I have PTSD",
  ])("does not treat %j as educational", (text) => {
    expect(isEducationalDiscussion(text)).toBe(false);
  });
});

describe("mentionsSelfHarmTopic (content-filter fallback screen)", () => {
  it("is looser than detectCrisis", () => {
    expect(mentionsSelfHarmTopic("I keep thinking about death")).toBe(true);
    expect(mentionsSelfHarmTopic("everything feels close to the end, למות")).toBe(
      true
    );
    expect(mentionsSelfHarmTopic("I want to kill myself")).toBe(true);
  });
  it("stays false for neutral therapist requests", () => {
    expect(mentionsSelfHarmTopic("find me a therapist in Haifa")).toBe(false);
    expect(mentionsSelfHarmTopic("")).toBe(false);
  });
});

describe("detectResponseLanguage", () => {
  it("picks Hebrew for Hebrew text and English otherwise", () => {
    expect(detectResponseLanguage("אני רוצה עזרה")).toBe("he");
    expect(detectResponseLanguage("I need help")).toBe("en");
    expect(detectResponseLanguage("")).toBe("en");
  });
});
