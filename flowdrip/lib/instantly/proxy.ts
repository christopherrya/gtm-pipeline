import { NextRequest, NextResponse } from "next/server";

const BASE_URL = process.env.INSTANTLY_BASE_URL || "https://api.instantly.ai/api/v2";

function getApiKey(req: NextRequest): string {
  return req.headers.get("x-instantly-key") || process.env.INSTANTLY_API_KEY || "";
}

export async function proxyToInstantly(req: NextRequest, path: string, method: string): Promise<NextResponse> {
  const apiKey = getApiKey(req);
  if (!apiKey) return NextResponse.json({ message: "API key required. Configure in Settings." }, { status: 401 });

  const headers: HeadersInit = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const options: RequestInit = { method, headers };

  if (method !== "GET" && method !== "DELETE") {
    try { options.body = JSON.stringify(await req.json()); } catch { /* no body */ }
  }

  try {
    const res = await fetch(`${BASE_URL}${path}`, options);
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json({ message: `Failed to reach Instantly API: ${error}` }, { status: 502 });
  }
}
