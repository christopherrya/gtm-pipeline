"use client";
import { useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { useCampaignStore } from "@/store/campaignStore";
import TopBar from "@/components/TopBar";
import Sidebar from "@/components/Sidebar";
import FlowCanvas from "@/components/FlowCanvas";
import ConfigPanel from "@/components/ConfigPanel";

export default function Home() {
  const { campaigns, createCampaign } = useCampaignStore();

  // Create a default campaign on first visit
  useEffect(() => {
    if (campaigns.length === 0) {
      createCampaign("Untitled Campaign");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ReactFlowProvider>
      <div className="flex h-screen flex-col bg-[#0a0a0a]">
        <TopBar />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <FlowCanvas />
          <ConfigPanel />
        </div>
      </div>
    </ReactFlowProvider>
  );
}
