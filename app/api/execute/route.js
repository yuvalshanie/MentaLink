import { NextResponse } from "next/server";
import { runMentaLinkAgent } from "@/lib/orchestrator";

export const maxDuration = 300;

export async function POST(request) {
  let prompt;
  try {
    const body = await request.json();
    prompt = body?.prompt;
  } catch {
    return NextResponse.json(
      {
        status: "error",
        error: "Request body must be valid JSON with a 'prompt' field.",
        response: null,
        steps: [],
      },
      { status: 400 }
    );
  }

  if (typeof prompt !== "string" || prompt.trim() === "") {
    return NextResponse.json(
      {
        status: "error",
        error: "The 'prompt' field must be a non-empty string.",
        response: null,
        steps: [],
      },
      { status: 400 }
    );
  }

  try {
    const { response, steps } = await runMentaLinkAgent(prompt);
    return NextResponse.json({
      status: "ok",
      error: null,
      response,
      steps,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        error: error.message || "The agent failed unexpectedly.",
        response: null,
        steps: [],
      },
      { status: 500 }
    );
  }
}
