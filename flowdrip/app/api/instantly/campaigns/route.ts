import { NextRequest } from "next/server";
import { proxyToInstantly } from "@/lib/instantly/proxy";

export async function GET(req: NextRequest) { return proxyToInstantly(req, "/campaigns", "GET"); }
export async function POST(req: NextRequest) { return proxyToInstantly(req, "/campaigns", "POST"); }
