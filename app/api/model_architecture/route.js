// Dummy 1x1 transparent PNG (base64). Replace with the real architecture
// diagram, e.g. by reading a PNG file from the project.
const DUMMY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export async function GET() {
  const pngBuffer = Buffer.from(DUMMY_PNG_BASE64, "base64");

  return new Response(pngBuffer, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
    },
  });
}
