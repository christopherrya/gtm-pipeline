import { NextRequest } from "next/server";
import { proxyToInstantly } from "@/lib/instantly/proxy";

export async function POST(req: NextRequest) { return proxyToInstantly(req, "/subsequences", "POST"); }
