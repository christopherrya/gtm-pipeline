"use client";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";

export default function ConditionNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown>;
  return (
    <div className={`w-[220px] rounded-lg border border-[#333] border-l-4 border-l-purple-500 bg-[#1a1a1a] p-3 shadow-lg ${selected ? "ring-2 ring-purple-500/50" : ""}`}>
      <Handle type="target" position={Position.Top} id="default" className="!h-3 !w-3 !rounded-full !border-2 !border-purple-500 !bg-[#1a1a1a]" />
      <div className="mb-2 flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-purple-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Condition</span>
      </div>
      <p className="truncate text-sm text-white">{(d.conditionType as string) || "Email opened"}</p>
      <div className="mt-2 flex justify-between text-xs">
        <span className="text-green-400">Yes</span>
        <span className="text-red-400">No</span>
      </div>
      <Handle type="source" position={Position.Bottom} id="yes" style={{ left: "25%" }} className="!h-3 !w-3 !rounded-full !border-2 !border-green-500 !bg-[#1a1a1a]" />
      <Handle type="source" position={Position.Bottom} id="no" style={{ left: "75%" }} className="!h-3 !w-3 !rounded-full !border-2 !border-red-500 !bg-[#1a1a1a]" />
    </div>
  );
}
