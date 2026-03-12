import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      message: "Download de modelo deve ser feito pela Edge Function get_project_forecast_template.",
    },
    { status: 405 },
  );
}
