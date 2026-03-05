"use client";
import { useCampaignStore } from "@/store/campaignStore";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import type { FlowDripVariant } from "@/lib/types/instantly";

interface VariantEditorProps { nodeId: string; data: Record<string, unknown>; }

export default function VariantEditor({ nodeId, data }: VariantEditorProps) {
  const updateNodeData = useCampaignStore((s) => s.updateNodeData);
  const variants = (data.variants as FlowDripVariant[]) || [];

  const addVariant = () => {
    updateNodeData(nodeId, { variants: [...variants, { id: `variant_${Date.now()}`, subject: "", body: "" }] });
  };
  const updateVariant = (index: number, field: "subject" | "body", value: string) => {
    updateNodeData(nodeId, { variants: variants.map((v, i) => i === index ? { ...v, [field]: value } : v) });
  };
  const removeVariant = (index: number) => {
    updateNodeData(nodeId, { variants: variants.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-gray-300">A/B Variants</Label>
        <Button size="sm" variant="ghost" onClick={addVariant} className="h-7 px-2 text-xs text-blue-400 hover:text-blue-300"><Plus className="mr-1 h-3 w-3" />Add Variant</Button>
      </div>
      <p className="text-xs text-gray-500">Variant A uses the subject &amp; body above. Add more for A/B testing.</p>
      {variants.length === 0 && <p className="text-xs italic text-gray-600">No additional variants.</p>}
      {variants.map((variant, index) => (
        <div key={variant.id} className="space-y-2 rounded-lg border border-[#333] bg-[#0f0f0f] p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">Variant {String.fromCharCode(66 + index)}</span>
            <button onClick={() => removeVariant(index)} className="rounded p-1 text-gray-500 hover:bg-[#333] hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
          </div>
          <div className="space-y-1"><Label className="text-xs text-gray-400">Subject</Label><Input value={variant.subject} onChange={(e) => updateVariant(index, "subject", e.target.value)} placeholder="Variant subject..." className="h-8 border-[#333] bg-[#1a1a1a] text-sm text-white placeholder:text-gray-600" /></div>
          <div className="space-y-1"><Label className="text-xs text-gray-400">Body</Label><Textarea value={variant.body} onChange={(e) => updateVariant(index, "body", e.target.value)} placeholder="Variant body..." rows={3} className="border-[#333] bg-[#1a1a1a] text-sm text-white placeholder:text-gray-600" /></div>
        </div>
      ))}
    </div>
  );
}
