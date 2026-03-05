"use client";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { Mail } from "lucide-react";

export default function EmailNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown>;
  return (
    <div className={`relative w-[220px] rounded-lg border border-[#333] border-l-4 border-l-blue-500 bg-[#1a1a1a] p-3 shadow-lg ${selected ? "ring-2 ring-blue-500/50" : ""}`}>
      <Handle type="target" position={Position.Top} id="default" className="!h-3 !w-3 !rounded-full !border-2 !border-blue-500 !bg-[#1a1a1a]" />
      <div className="mb-2 flex items-center gap-2">
        <Mail className="h-4 w-4 text-blue-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Email</span>
      </div>
      <p className="truncate text-sm text-white">{(d.subject as string) || "Untitled Email"}</p>
      {d.previewText ? <p className="mt-1 truncate text-xs text-gray-500">{d.previewText as string}</p> : null}
      {((d.variants as Array<unknown>) || []).length > 0 ? (
        <div className="mt-1 inline-block rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] text-blue-400">
          {(d.variants as Array<unknown>).length + 1} variants
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} id="default" className="!h-3 !w-3 !rounded-full !border-2 !border-blue-500 !bg-[#1a1a1a]" />
    </div>
  );
}
