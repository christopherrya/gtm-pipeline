"use client";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { CircleStop } from "lucide-react";

export default function EndNode({ data, selected }: NodeProps) {
  return (
    <div className={`w-[220px] rounded-lg border border-[#333] border-l-4 border-l-red-500 bg-[#1a1a1a] p-3 shadow-lg ${selected ? "ring-2 ring-red-500/50" : ""}`}>
      <Handle type="target" position={Position.Top} id="default" className="!h-3 !w-3 !rounded-full !border-2 !border-red-500 !bg-[#1a1a1a]" />
      <div className="mb-2 flex items-center gap-2">
        <CircleStop className="h-4 w-4 text-red-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">End</span>
      </div>
      <p className="text-sm text-gray-300">End Sequence</p>
    </div>
  );
}
