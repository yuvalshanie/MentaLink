import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    description: "AI-Powered Therapist Matchmaking agent...",
    purpose: "Match users with therapists...",
    prompt_template: { template: "..." },
    prompt_examples: [],
  });
}
