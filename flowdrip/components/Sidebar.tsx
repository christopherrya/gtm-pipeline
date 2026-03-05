"use client";
import { useState } from "react";
import { useCampaignStore, type Campaign } from "@/store/campaignStore";
import { Zap, Mail, Clock, GitBranch, CircleStop, Plus, Copy, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

const nodeItems = [
  { type: "trigger", label: "Trigger", description: "Start your email sequence", icon: Zap, color: "border-l-green-500", iconColor: "text-green-500" },
  { type: "email", label: "Email", description: "Send an email to contacts", icon: Mail, color: "border-l-blue-500", iconColor: "text-blue-500" },
  { type: "delay", label: "Delay", description: "Wait before next step", icon: Clock, color: "border-l-amber-500", iconColor: "text-amber-500" },
  { type: "condition", label: "Condition", description: "Branch based on behavior", icon: GitBranch, color: "border-l-purple-500", iconColor: "text-purple-500" },
  { type: "end", label: "End", description: "End the sequence", icon: CircleStop, color: "border-l-red-500", iconColor: "text-red-500" },
];

export default function Sidebar() {
  const { campaigns, activeCampaignId, createCampaign, switchCampaign, deleteCampaign, duplicateCampaign } = useCampaignStore();
  const [campaignsOpen, setCampaignsOpen] = useState(true);

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  const handleNew = () => {
    createCampaign();
    toast.success("New campaign created");
  };

  const handleDelete = (e: React.MouseEvent, camp: Campaign) => {
    e.stopPropagation();
    if (campaigns.length <= 1) { toast.error("Can't delete the last campaign"); return; }
    if (confirm(`Delete "${camp.name}"?`)) {
      deleteCampaign(camp.id);
      toast.info(`Deleted "${camp.name}"`);
    }
  };

  const handleDuplicate = (e: React.MouseEvent, camp: Campaign) => {
    e.stopPropagation();
    duplicateCampaign(camp.id);
    toast.success(`Duplicated "${camp.name}"`);
  };

  return (
    <aside className="flex h-full w-[260px] flex-col border-r border-[#333] bg-[#111]">
      {/* Campaign list */}
      <div className="border-b border-[#333]">
        <button onClick={() => setCampaignsOpen(!campaignsOpen)} className="flex w-full items-center justify-between p-4 text-left">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Campaigns</h2>
          {campaignsOpen ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
        </button>
        {campaignsOpen && (
          <div className="flex flex-col gap-1 px-3 pb-3">
            {campaigns.map((camp) => (
              <div
                key={camp.id}
                onClick={() => switchCampaign(camp.id)}
                className={`group flex cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors ${camp.id === activeCampaignId ? "bg-[#1a1a1a] text-white" : "text-gray-400 hover:bg-[#1a1a1a]/50 hover:text-gray-200"}`}
              >
                <span className="truncate">{camp.name}</span>
                <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
                  <button onClick={(e) => handleDuplicate(e, camp)} className="rounded p-0.5 hover:bg-[#333]" title="Duplicate"><Copy className="h-3 w-3" /></button>
                  <button onClick={(e) => handleDelete(e, camp)} className="rounded p-0.5 hover:bg-[#333] hover:text-red-400" title="Delete"><Trash2 className="h-3 w-3" /></button>
                </div>
              </div>
            ))}
            <button onClick={handleNew} className="mt-1 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:bg-[#1a1a1a]/50 hover:text-gray-300">
              <Plus className="h-3 w-3" />New Campaign
            </button>
          </div>
        )}
      </div>

      {/* Node palette */}
      <div className="border-b border-[#333] p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Nodes</h2>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto p-3">
        {nodeItems.map((item) => (
          <div key={item.type} draggable onDragStart={(e) => onDragStart(e, item.type)} className={`sidebar-node-card rounded-lg border border-[#333] border-l-4 ${item.color} bg-[#1a1a1a] p-3`}>
            <div className="flex items-center gap-2">
              <item.icon className={`h-4 w-4 ${item.iconColor}`} />
              <span className="text-sm font-medium text-white">{item.label}</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">{item.description}</p>
          </div>
        ))}
      </div>
    </aside>
  );
}
