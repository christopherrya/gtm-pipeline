import { NextRequest } from "next/server";
import { proxyToInstantly } from "@/lib/instantly/proxy";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToInstantly(req, `/campaigns/${id}`, "PATCH");
}
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToInstantly(req, `/campaigns/${id}`, "DELETE");
}
