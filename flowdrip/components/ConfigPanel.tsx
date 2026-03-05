"use client";
import { useCampaignStore } from "@/store/campaignStore";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Zap, Mail, Clock, GitBranch, CircleStop } from "lucide-react";
import VariantEditor from "@/components/VariantEditor";

const nodeIcons: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  trigger: { icon: Zap, color: "text-green-500", label: "Trigger" },
  email: { icon: Mail, color: "text-blue-500", label: "Email" },
  delay: { icon: Clock, color: "text-amber-500", label: "Delay" },
  condition: { icon: GitBranch, color: "text-purple-500", label: "Condition" },
  end: { icon: CircleStop, color: "text-red-500", label: "End" },
};

export default function ConfigPanel() {
  const { selectedNodeId, nodes, updateNodeData, setSelectedNode } = useCampaignStore();
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  if (!selectedNode || !selectedNodeId) return null;

  const nodeInfo = nodeIcons[selectedNode.type || ""] || nodeIcons.end;
  const Icon = nodeInfo.icon;
  const data = selectedNode.data as Record<string, unknown>;
  const updateField = (field: string, value: unknown) => updateNodeData(selectedNodeId, { [field]: value });

  return (
    <aside className="flex h-full w-[320px] flex-col border-l border-[#333] bg-[#111]">
      <div className="flex items-center justify-between border-b border-[#333] p-4">
        <div className="flex items-center gap-2"><Icon className={`h-5 w-5 ${nodeInfo.color}`} /><h3 className="font-semibold text-white">{nodeInfo.label} Settings</h3></div>
        <button onClick={() => setSelectedNode(null)} className="rounded p-1 text-gray-400 hover:bg-[#333] hover:text-white"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {selectedNode.type === "trigger" && (
          <div className="space-y-2">
            <Label className="text-sm font-medium text-gray-300">Trigger Type</Label>
            <Select value={(data.triggerType as string) || "Contact added to list"} onValueChange={(v) => updateField("triggerType", v)}>
              <SelectTrigger className="w-full border-[#333] bg-[#1a1a1a] text-white"><SelectValue /></SelectTrigger>
              <SelectContent className="border-[#333] bg-[#1a1a1a]">
                <SelectItem value="Contact added to list">Contact added to list</SelectItem>
                <SelectItem value="Form submitted">Form submitted</SelectItem>
                <SelectItem value="Manual trigger">Manual trigger</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {selectedNode.type === "email" && (
          <>
            <div className="space-y-2"><Label className="text-sm font-medium text-gray-300">Subject Line</Label><Input value={(data.subject as string) || ""} onChange={(e) => updateField("subject", e.target.value)} placeholder="Enter subject line..." className="border-[#333] bg-[#1a1a1a] text-white placeholder:text-gray-600" /></div>
            <div className="space-y-2"><Label className="text-sm font-medium text-gray-300">Preview Text</Label><Input value={(data.previewText as string) || ""} onChange={(e) => updateField("previewText", e.target.value)} placeholder="Preview text..." className="border-[#333] bg-[#1a1a1a] text-white placeholder:text-gray-600" /></div>
            <div className="space-y-2"><Label className="text-sm font-medium text-gray-300">Email Body</Label><Textarea value={(data.body as string) || ""} onChange={(e) => updateField("body", e.target.value)} placeholder="Write your email content..." rows={6} className="border-[#333] bg-[#1a1a1a] text-white placeholder:text-gray-600" /></div>
            <div className="space-y-2"><Label className="text-sm font-medium text-gray-300">From Name</Label><Input value={(data.fromName as string) || ""} onChange={(e) => updateField("fromName", e.target.value)} placeholder="John Doe" className="border-[#333] bg-[#1a1a1a] text-white placeholder:text-gray-600" /></div>
            <div className="space-y-2"><Label className="text-sm font-medium text-gray-300">From Email</Label><Input type="email" value={(data.fromEmail as string) || ""} onChange={(e) => updateField("fromEmail", e.target.value)} placeholder="john@example.com" className="border-[#333] bg-[#1a1a1a] text-white placeholder:text-gray-600" /></div>
            <div className="border-t border-[#333] pt-4 mt-4"><VariantEditor nodeId={selectedNodeId} data={data} /></div>
          </>
        )}
        {selectedNode.type === "delay" && (
          <>
            <div className="space-y-2"><Label className="text-sm font-medium text-gray-300">Wait Duration</Label><Input type="number" min={1} value={(data.duration as number) || 1} onChange={(e) => updateField("duration", parseInt(e.target.value) || 1)} className="border-[#333] bg-[#1a1a1a] text-white" /></div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-300">Unit</Label>
              <Select value={(data.unit as string) || "days"} onValueChange={(v) => updateField("unit", v)}>
                <SelectTrigger className="w-full border-[#333] bg-[#1a1a1a] text-white"><SelectValue /></SelectTrigger>
                <SelectContent className="border-[#333] bg-[#1a1a1a]"><SelectItem value="minutes">Minutes</SelectItem><SelectItem value="hours">Hours</SelectItem><SelectItem value="days">Days</SelectItem><SelectItem value="weeks">Weeks</SelectItem></SelectContent>
              </Select>
            </div>
          </>
        )}
        {selectedNode.type === "condition" && (
          <div className="space-y-2">
            <Label className="text-sm font-medium text-gray-300">Condition Type</Label>
            <Select value={(data.conditionType as string) || "Email opened"} onValueChange={(v) => updateField("conditionType", v)}>
              <SelectTrigger className="w-full border-[#333] bg-[#1a1a1a] text-white"><SelectValue /></SelectTrigger>
              <SelectContent className="border-[#333] bg-[#1a1a1a]"><SelectItem value="Email opened">Email opened</SelectItem><SelectItem value="Email clicked">Email clicked</SelectItem><SelectItem value="Email bounced">Email bounced</SelectItem></SelectContent>
            </Select>
          </div>
        )}
        {selectedNode.type === "end" && <p className="text-sm text-gray-500">This node marks the end of the sequence. No configuration needed.</p>}
      </div>
    </aside>
  );
}
