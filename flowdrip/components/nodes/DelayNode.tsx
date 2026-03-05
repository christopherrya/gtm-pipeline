"use client";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { Clock } from "lucide-react";

export default function DelayNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown>;
  const duration = (d.duration as number) ?? 1;
  const unit = (d.unit as string) || "days";
  return (
    <div className={`w-[220px] rounded-lg border border-[#333] border-l-4 border-l-amber-500 bg-[#1a1a1a] p-3 shadow-lg ${selected ? "ring-2 ring-amber-500/50" : ""}`}>
      <Handle type="target" position={Position.Top} id="default" className="!h-3 !w-3 !rounded-full !border-2 !border-amber-500 !bg-[#1a1a1a]" />
      <div className="mb-2 flex items-center gap-2">
        <Clock className="h-4 w-4 text-amber-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Delay</span>
      </div>
      <p className="text-sm text-white">Wait {duration} {unit}</p>
      <Handle type="source" position={Position.Bottom} id="default" className="!h-3 !w-3 !rounded-full !border-2 !border-amber-500 !bg-[#1a1a1a]" />
    </div>
  );
}
