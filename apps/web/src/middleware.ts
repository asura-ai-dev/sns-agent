import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL || "http://localhost:3001";
const SESSION_USER_ID = process.env.SNS_AGENT_SESSION_USER_ID || "user-owner-00000000";

export function middleware(request: NextRequest) {
  const dest = new URL(request.nextUrl.pathname + request.nextUrl.search, API_URL);

  const headers = new Headers(request.headers);
  if (!headers.has("X-Session-User-Id") && SESSION_USER_ID) {
    headers.set("X-Session-User-Id", SESSION_USER_ID);
  }

  return NextResponse.rewrite(dest, { request: { headers } });
}

export const config = {
  matcher: "/api/:path*",
};
