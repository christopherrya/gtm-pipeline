"use client";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";

export default function TriggerNode({ data, selected }: NodeProps) {
  return (
    <div className={`w-[220px] rounded-lg border border-[#333] border-l-4 border-l-green-500 bg-[#1a1a1a] p-3 shadow-lg ${selected ? "ring-2 ring-green-500/50" : ""}`}>
      <div className="mb-2 flex items-center gap-2">
        <Zap className="h-4 w-4 text-green-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Trigger</span>
      </div>
      <p className="truncate text-sm text-white">{(data as Record<string, unknown>).triggerType as string || "Contact added to list"}</p>
      <Handle type="source" position={Position.Bottom} id="default" className="!h-3 !w-3 !rounded-full !border-2 !border-green-500 !bg-[#1a1a1a]" />
    </div>
  );
}
