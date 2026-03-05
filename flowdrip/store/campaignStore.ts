import { create } from 'zustand';
import { Node, Edge, NodeChange, EdgeChange, Connection, addEdge, applyNodeChanges, applyEdgeChanges } from '@xyflow/react';

// ── Types ──

export interface Campaign {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  instantlyCampaignId: string | null;
  campaignSchedule: CampaignSchedule;
  createdAt: string;
  updatedAt: string;
}

interface CampaignSchedule {
  startDate: string;
  endDate: string;
  timezone: string;
  fromTime: string;
  toTime: string;
  days: Record<string, boolean>;
}

interface CampaignState {
  // Multi-campaign
  campaigns: Campaign[];
  activeCampaignId: string | null;

  // Current canvas state (derived from active campaign)
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  campaignName: string;

  // Instantly integration
  instantlyApiKey: string;
  instantlyCampaignId: string | null;
  instantlyStatus: "idle" | "pushing" | "success" | "error";
  instantlyError: string | null;
  campaignSchedule: CampaignSchedule;

  // Campaign management
  createCampaign: (name?: string) => string;
  switchCampaign: (id: string) => void;
  deleteCampaign: (id: string) => void;
  duplicateCampaign: (id: string) => void;

  // Node/edge actions
  addNode: (node: Node) => void;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  removeNode: (nodeId: string) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setCampaignName: (name: string) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  clearCanvas: () => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;

  // Instantly
  setInstantlyApiKey: (key: string) => void;
  setInstantlyCampaignId: (id: string | null) => void;
  setInstantlyStatus: (status: "idle" | "pushing" | "success" | "error") => void;
  setInstantlyError: (error: string | null) => void;
  setCampaignSchedule: (schedule: Partial<CampaignSchedule>) => void;
}

// ── Persistence ──

const STORAGE_KEY = "flowdrip-campaigns";
const ACTIVE_KEY = "flowdrip-active-campaign";
const API_KEY_STORAGE = "flowdrip-instantly-key";

function loadCampaigns(): Campaign[] {
  if (typeof window === "undefined") return [];
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}

function saveCampaigns(campaigns: Campaign[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(campaigns));
}

function loadActiveCampaignId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_KEY);
}

function saveActiveCampaignId(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) localStorage.setItem(ACTIVE_KEY, id); else localStorage.removeItem(ACTIVE_KEY);
}

function loadApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(API_KEY_STORAGE) || "";
}

function saveApiKey(key: string) {
  if (typeof window === "undefined") return;
  if (key) localStorage.setItem(API_KEY_STORAGE, key); else localStorage.removeItem(API_KEY_STORAGE);
}

function generateId(): string {
  return `camp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultSchedule(): CampaignSchedule {
  return {
    startDate: new Date().toISOString().split("T")[0], endDate: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    fromTime: "09:00", toTime: "17:00",
    days: { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false },
  };
}

function makeNewCampaign(name: string): Campaign {
  const now = new Date().toISOString();
  return { id: generateId(), name, nodes: [], edges: [], instantlyCampaignId: null, campaignSchedule: defaultSchedule(), createdAt: now, updatedAt: now };
}

// Snapshot current canvas back into the campaigns list
function snapshot(state: CampaignState): Campaign[] {
  if (!state.activeCampaignId) return state.campaigns;
  return state.campaigns.map((c) =>
    c.id === state.activeCampaignId
      ? { ...c, name: state.campaignName, nodes: state.nodes, edges: state.edges, instantlyCampaignId: state.instantlyCampaignId, campaignSchedule: state.campaignSchedule, updatedAt: new Date().toISOString() }
      : c
  );
}

// ── Initialize from localStorage ──

const initCampaigns = loadCampaigns();
const initActiveId = loadActiveCampaignId();
const initActive = initCampaigns.find((c) => c.id === initActiveId) || initCampaigns[0] || null;

// ── Store ──

export const useCampaignStore = create<CampaignState>((set, get) => ({
  campaigns: initCampaigns,
  activeCampaignId: initActive?.id || null,
  nodes: initActive?.nodes || [],
  edges: initActive?.edges || [],
  selectedNodeId: null,
  campaignName: initActive?.name || "Untitled Campaign",
  instantlyApiKey: loadApiKey(),
  instantlyCampaignId: initActive?.instantlyCampaignId || null,
  instantlyStatus: "idle",
  instantlyError: null,
  campaignSchedule: initActive?.campaignSchedule || defaultSchedule(),

  // ── Campaign management ──

  createCampaign: (name) => {
    const state = get();
    const saved = snapshot(state);
    const fresh = makeNewCampaign(name || "Untitled Campaign");
    const campaigns = [...saved, fresh];
    saveCampaigns(campaigns);
    saveActiveCampaignId(fresh.id);
    set({ campaigns, activeCampaignId: fresh.id, nodes: [], edges: [], selectedNodeId: null, campaignName: fresh.name, instantlyCampaignId: null, instantlyStatus: "idle", instantlyError: null, campaignSchedule: fresh.campaignSchedule });
    return fresh.id;
  },

  switchCampaign: (id) => {
    const state = get();
    const saved = snapshot(state);
    saveCampaigns(saved);
    const target = saved.find((c) => c.id === id);
    if (!target) return;
    saveActiveCampaignId(id);
    set({ campaigns: saved, activeCampaignId: id, nodes: target.nodes, edges: target.edges, selectedNodeId: null, campaignName: target.name, instantlyCampaignId: target.instantlyCampaignId, instantlyStatus: "idle", instantlyError: null, campaignSchedule: target.campaignSchedule });
  },

  deleteCampaign: (id) => {
    const state = get();
    const campaigns = snapshot(state).filter((c) => c.id !== id);
    saveCampaigns(campaigns);
    if (state.activeCampaignId === id) {
      const next = campaigns[0] || null;
      saveActiveCampaignId(next?.id || null);
      set({ campaigns, activeCampaignId: next?.id || null, nodes: next?.nodes || [], edges: next?.edges || [], selectedNodeId: null, campaignName: next?.name || "Untitled Campaign", instantlyCampaignId: next?.instantlyCampaignId || null, instantlyStatus: "idle", instantlyError: null, campaignSchedule: next?.campaignSchedule || defaultSchedule() });
    } else {
      set({ campaigns });
    }
  },

  duplicateCampaign: (id) => {
    const state = get();
    const saved = snapshot(state);
    const source = saved.find((c) => c.id === id);
    if (!source) return;
    const now = new Date().toISOString();
    const dup: Campaign = { ...source, id: generateId(), name: `${source.name} (copy)`, instantlyCampaignId: null, createdAt: now, updatedAt: now };
    const campaigns = [...saved, dup];
    saveCampaigns(campaigns);
    saveActiveCampaignId(dup.id);
    set({ campaigns, activeCampaignId: dup.id, nodes: dup.nodes, edges: dup.edges, selectedNodeId: null, campaignName: dup.name, instantlyCampaignId: null, instantlyStatus: "idle", instantlyError: null, campaignSchedule: dup.campaignSchedule });
  },

  // ── Node/edge actions (auto-persist) ──

  addNode: (node) => set((state) => {
    const nodes = [...state.nodes, node];
    const campaigns = snapshot({ ...state, nodes });
    saveCampaigns(campaigns);
    return { nodes, campaigns };
  }),
  updateNodeData: (nodeId, data) => set((state) => {
    const nodes = state.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n);
    const campaigns = snapshot({ ...state, nodes });
    saveCampaigns(campaigns);
    return { nodes, campaigns };
  }),
  removeNode: (nodeId) => set((state) => {
    const nodes = state.nodes.filter((n) => n.id !== nodeId);
    const edges = state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
    const selectedNodeId = state.selectedNodeId === nodeId ? null : state.selectedNodeId;
    const campaigns = snapshot({ ...state, nodes, edges });
    saveCampaigns(campaigns);
    return { nodes, edges, selectedNodeId, campaigns };
  }),
  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),
  setCampaignName: (name) => set((state) => {
    const campaigns = snapshot({ ...state, campaignName: name });
    saveCampaigns(campaigns);
    return { campaignName: name, campaigns };
  }),
  onNodesChange: (changes) => set((state) => {
    const nodes = applyNodeChanges(changes, state.nodes);
    const campaigns = snapshot({ ...state, nodes });
    saveCampaigns(campaigns);
    return { nodes, campaigns };
  }),
  onEdgesChange: (changes) => set((state) => {
    const edges = applyEdgeChanges(changes, state.edges);
    const campaigns = snapshot({ ...state, edges });
    saveCampaigns(campaigns);
    return { edges, campaigns };
  }),
  onConnect: (connection) => set((state) => {
    const sourceNode = state.nodes.find((n) => n.id === connection.source);
    let edgeProps: Partial<Edge> = { animated: true, style: { stroke: '#fff', strokeWidth: 2 }, type: 'default' };
    if (sourceNode?.type === 'condition') {
      if (connection.sourceHandle === 'yes') {
        edgeProps = { ...edgeProps, label: 'Yes', labelStyle: { fill: '#22c55e', fontWeight: 600, fontSize: 12 }, labelBgStyle: { fill: '#1a1a1a', fillOpacity: 0.8 }, style: { stroke: '#22c55e', strokeWidth: 2 } };
      } else if (connection.sourceHandle === 'no') {
        edgeProps = { ...edgeProps, label: 'No', labelStyle: { fill: '#ef4444', fontWeight: 600, fontSize: 12 }, labelBgStyle: { fill: '#1a1a1a', fillOpacity: 0.8 }, style: { stroke: '#ef4444', strokeWidth: 2 } };
      }
    }
    const edges = addEdge({ ...connection, ...edgeProps }, state.edges);
    const campaigns = snapshot({ ...state, edges });
    saveCampaigns(campaigns);
    return { edges, campaigns };
  }),
  clearCanvas: () => set((state) => {
    const campaigns = snapshot({ ...state, nodes: [], edges: [], instantlyCampaignId: null });
    saveCampaigns(campaigns);
    return { nodes: [], edges: [], selectedNodeId: null, instantlyCampaignId: null, instantlyStatus: "idle" as const, instantlyError: null, campaigns };
  }),
  setNodes: (nodes) => set((state) => { const campaigns = snapshot({ ...state, nodes }); saveCampaigns(campaigns); return { nodes, campaigns }; }),
  setEdges: (edges) => set((state) => { const campaigns = snapshot({ ...state, edges }); saveCampaigns(campaigns); return { edges, campaigns }; }),

  // ── Instantly ──

  setInstantlyApiKey: (key) => { saveApiKey(key); set({ instantlyApiKey: key }); },
  setInstantlyCampaignId: (id) => set((state) => {
    const campaigns = snapshot({ ...state, instantlyCampaignId: id });
    saveCampaigns(campaigns);
    return { instantlyCampaignId: id, campaigns };
  }),
  setInstantlyStatus: (status) => set({ instantlyStatus: status }),
  setInstantlyError: (error) => set({ instantlyError: error }),
  setCampaignSchedule: (schedule) => set((state) => {
    const campaignSchedule = { ...state.campaignSchedule, ...schedule };
    const campaigns = snapshot({ ...state, campaignSchedule });
    saveCampaigns(campaigns);
    return { campaignSchedule, campaigns };
  }),
}));
