"use client";
import { useCallback, useRef } from "react";
import { ReactFlow, Background, Controls, MiniMap, useReactFlow, BackgroundVariant, type NodeMouseHandler, MarkerType } from "@xyflow/react";
import { useCampaignStore } from "@/store/campaignStore";
import { nodeTypes } from "@/lib/nodeTypes";
import { toast } from "sonner";

const defaultNodeData: Record<string, Record<string, unknown>> = {
  trigger: { triggerType: "Contact added to list", label: "Trigger" },
  email: { subject: "", previewText: "", body: "", fromName: "", fromEmail: "", variants: [], label: "Email" },
  delay: { duration: 1, unit: "days", label: "Delay" },
  condition: { conditionType: "Email opened", label: "Condition" },
  end: { label: "End" },
};

let nodeId = 0;
const getId = () => `node_${++nodeId}`;

export default function FlowCanvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, addNode, setSelectedNode } = useCampaignStore();

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const type = event.dataTransfer.getData("application/reactflow");
    if (!type) return;
    if (type === "trigger" && nodes.find((n) => n.type === "trigger")) {
      toast.error("Only one Trigger node is allowed per campaign.");
      return;
    }
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addNode({ id: getId(), type, position, data: { ...defaultNodeData[type] } });
  }, [screenToFlowPosition, addNode, nodes]);

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => { setSelectedNode(node.id); }, [setSelectedNode]);
  const onPaneClick = useCallback(() => { setSelectedNode(null); }, [setSelectedNode]);

  return (
    <div ref={reactFlowWrapper} className="flex-1 h-full">
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onDrop={onDrop} onDragOver={onDragOver} onNodeClick={onNodeClick} onPaneClick={onPaneClick} nodeTypes={nodeTypes} defaultEdgeOptions={{ animated: true, style: { stroke: "#fff", strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: "#fff" } }} fitView deleteKeyCode={["Backspace", "Delete"]} className="bg-[#0f0f0f]" proOptions={{ hideAttribution: true }}>
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#333" />
        <Controls className="!bottom-4 !left-4" />
        <MiniMap className="!bottom-4 !right-4" nodeColor={(node) => {
          switch (node.type) { case "trigger": return "#22c55e"; case "email": return "#3b82f6"; case "delay": return "#f59e0b"; case "condition": return "#a855f7"; case "end": return "#ef4444"; default: return "#666"; }
        }} maskColor="rgba(0, 0, 0, 0.7)" />
      </ReactFlow>
    </div>
  );
}
