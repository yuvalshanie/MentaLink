import { readFile } from "node:fs/promises";
import path from "node:path";

// Serves the MentaLink architecture diagram (public/model_architecture.png).
// Module names in the diagram match the code and the /api/execute steps:
// UserRequestAnalyzer, MatchmakerAgent, EthicalGuardianAgent.
export async function GET() {
  try {
    const filePath = path.join(
      process.cwd(),
      "public",
      "model_architecture.png"
    );
    const pngBuffer = await readFile(filePath);
    return new Response(pngBuffer, {
      status: 200,
      headers: { "Content-Type": "image/png" },
    });
  } catch {
    return new Response("Architecture diagram not found.", { status: 500 });
  }
}
