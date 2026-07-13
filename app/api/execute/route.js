import { NextResponse } from "next/server";
// import { runMatchmakerAgent, runEthicalGuardian } from "@/lib/agents";

export async function POST(request) {
  try {
    const { prompt } = await request.json();

    const steps = [];

    // TODO: Run the Matchmaker agent:
    // const matchmaker = await runMatchmakerAgent(prompt);
    // steps.push(matchmaker.step);

    // TODO: Run the Ethical Guardian on the matchmaker output:
    // const guardian = await runEthicalGuardian(matchmaker.response);
    // steps.push(guardian.step);

    return NextResponse.json({
      status: "ok",
      error: null,
      response: "Final dummy response",
      steps: steps,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        error: error.message,
        response: null,
        steps: [],
      },
      { status: 500 }
    );
  }
}
