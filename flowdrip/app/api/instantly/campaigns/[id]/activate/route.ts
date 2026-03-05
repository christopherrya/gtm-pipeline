import { NextRequest } from "next/server";
import { proxyToInstantly } from "@/lib/instantly/proxy";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToInstantly(req, `/campaigns/${id}/activate`, "POST");
}
