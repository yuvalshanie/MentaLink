import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    group_batch_order_number: "batch3_order7",
    team_name: "MentaLink",
    students: [
      { name: "Yuval Shanie", email: "yuval.shanie@campus.technion.ac.il" },
      { name: "Lihi Bar-Tal", email: "lihi.bartal@campus.technion.ac.il" },
      { name: "Noi Feigenbaum", email: "noi.f@campus.technion.ac.il" },
    ],
  });
}
