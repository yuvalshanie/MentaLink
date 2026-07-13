import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    group_batch_order_number: "batch#_order#",
    team_name: "MentaLink",
    students: [
      { name: "Student A", email: "a@example.com" },
    ],
  });
}
