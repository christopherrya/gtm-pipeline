import type { InstantlyCampaignCreate, InstantlyCampaignResponse, InstantlyListResponse, InstantlySubsequenceCreate } from "@/lib/types/instantly";

async function instantlyFetch<T>(path: string, method: string, apiKeyOverride?: string, body?: unknown): Promise<T> {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (apiKeyOverride) headers["x-instantly-key"] = apiKeyOverride;
  const options: RequestInit = { method, headers };
  if (body && method !== "GET" && method !== "DELETE") options.body = JSON.stringify(body);
  const res = await fetch(`/api/instantly${path}`, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Instantly API error (${res.status})`);
  return data as T;
}

export async function createCampaign(payload: InstantlyCampaignCreate, apiKeyOverride?: string) {
  return instantlyFetch<InstantlyCampaignResponse>("/campaigns", "POST", apiKeyOverride, payload);
}
export async function listCampaigns(apiKeyOverride?: string) {
  return instantlyFetch<InstantlyListResponse>("/campaigns", "GET", apiKeyOverride);
}
export async function activateCampaign(id: string, apiKeyOverride?: string) {
  await instantlyFetch(`/campaigns/${id}/activate`, "POST", apiKeyOverride);
}
export async function pauseCampaign(id: string, apiKeyOverride?: string) {
  await instantlyFetch(`/campaigns/${id}/pause`, "POST", apiKeyOverride);
}
export async function deleteCampaign(id: string, apiKeyOverride?: string) {
  await instantlyFetch(`/campaigns/${id}`, "DELETE", apiKeyOverride);
}
export async function createSubsequence(payload: InstantlySubsequenceCreate, apiKeyOverride?: string) {
  return instantlyFetch<{ id: string }>("/subsequences", "POST", apiKeyOverride, payload);
}
