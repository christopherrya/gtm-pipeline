"use client";
import { useState } from "react";
import { useCampaignStore } from "@/store/campaignStore";
import { validateCampaign, validateForInstantly } from "@/lib/validation";
import { transformGraphToInstantly } from "@/lib/instantly/transform";
import { createCampaign, createSubsequence } from "@/lib/instantly/client";
import type { InstantlyCampaignSchedule } from "@/lib/types/instantly";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import InstantlySettingsDialog from "@/components/InstantlySettingsDialog";
import { Droplets, Download, Trash2, Loader2, Upload, Lock } from "lucide-react";
import { toast } from "sonner";

const PUSH_PASSWORD = "Lic17pow!";

export default function TopBar() {
  const { campaignName, setCampaignName, nodes, edges, clearCanvas, instantlyApiKey, instantlyCampaignId, instantlyStatus, campaignSchedule, setInstantlyCampaignId, setInstantlyStatus, setInstantlyError } = useCampaignStore();
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(false);

  const buildSchedulePayload = (): InstantlyCampaignSchedule => ({
    ...(campaignSchedule.startDate ? { start_date: campaignSchedule.startDate } : {}),
    ...(campaignSchedule.endDate ? { end_date: campaignSchedule.endDate } : {}),
    schedules: [{ name: "Default Schedule", timing: { from: campaignSchedule.fromTime, to: campaignSchedule.toTime }, days: campaignSchedule.days, timezone: campaignSchedule.timezone }],
  });

  const handleSave = () => {
    const result = validateCampaign(nodes, edges);
    if (result.warnings.length > 0) result.warnings.forEach((w) => toast.warning(w));
    if (!result.valid) { result.errors.forEach((e) => toast.error(e)); return; }
    const campaign = { name: campaignName, steps: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })), connections: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, label: e.label })), _flowState: { nodes, edges }, exportedAt: new Date().toISOString(), version: "1.0.0" };
    const blob = new Blob([JSON.stringify(campaign, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${campaignName.replace(/\s+/g, "-").toLowerCase()}.json`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Campaign saved!");
  };

  const handleClear = () => {
    if (nodes.length === 0) return;
    if (confirm("Clear the canvas? This cannot be undone.")) { clearCanvas(); toast.info("Canvas cleared."); }
  };

  const handlePushClick = () => {
    const result = validateCampaign(nodes, edges);
    if (!result.valid) { result.errors.forEach((e) => toast.error(e)); return; }
    const ir = validateForInstantly(nodes, edges);
    if (!ir.valid) { ir.errors.forEach((e) => toast.error(e)); return; }
    setPasswordInput("");
    setPasswordError(false);
    setShowPasswordDialog(true);
  };

  const handlePasswordSubmit = async () => {
    if (passwordInput !== PUSH_PASSWORD) {
      setPasswordError(true);
      return;
    }
    setShowPasswordDialog(false);
    setPasswordInput("");
    setPasswordError(false);
    await executePush();
  };

  const executePush = async () => {
    const ir = validateForInstantly(nodes, edges);
    if (ir.warnings.length > 0) ir.warnings.forEach((w) => toast.warning(w));

    const { campaign, subsequences, warnings } = transformGraphToInstantly(nodes, edges, campaignName, buildSchedulePayload());
    warnings.forEach((w) => toast.warning(w));

    setInstantlyStatus("pushing");
    try {
      const created = await createCampaign(campaign, instantlyApiKey || undefined);
      setInstantlyCampaignId(created.id);
      for (const sub of subsequences) {
        await createSubsequence({ ...sub, parent_campaign: created.id }, instantlyApiKey || undefined);
      }
      setInstantlyStatus("success");
      toast.success(`Campaign "${campaignName}" pushed to Instantly!`);
    } catch (err: unknown) {
      setInstantlyStatus("error");
      const msg = err instanceof Error ? err.message : "Unknown error";
      setInstantlyError(msg);
      toast.error(`Failed: ${msg}`);
    }
  };

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-[#333] bg-[#111] px-4">
        <div className="flex items-center gap-2">
          <Droplets className="h-6 w-6 text-blue-400" />
          <span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-lg font-bold text-transparent">FlowDrip</span>
        </div>
        <div className="flex items-center">
          <Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} className="max-w-[300px] border-transparent bg-transparent text-center text-white focus:border-[#555]" />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleClear} className="text-gray-400 hover:text-white"><Trash2 className="mr-1 h-4 w-4" />Clear</Button>
          <Button size="sm" onClick={handleSave} className="bg-blue-600 hover:bg-blue-700"><Download className="mr-1 h-4 w-4" />Save JSON</Button>
          <InstantlySettingsDialog />
          <Button size="sm" onClick={handlePushClick} disabled={instantlyStatus === "pushing"} className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700">
            {instantlyStatus === "pushing" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
            {instantlyCampaignId ? "Update on Instantly" : "Push to Instantly"}
          </Button>
        </div>
      </header>

      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent className="max-w-sm border-[#333] bg-[#111] text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Lock className="h-4 w-4 text-purple-400" />Authorize Push</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-400">Enter the push password to send this campaign to Instantly.</p>
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-400">Password</Label>
              <Input
                type="password"
                value={passwordInput}
                onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(false); }}
                onKeyDown={(e) => { if (e.key === "Enter") handlePasswordSubmit(); }}
                placeholder="Enter password..."
                className={`border-[#333] bg-[#1a1a1a] text-white placeholder:text-gray-600 ${passwordError ? "border-red-500" : ""}`}
                autoFocus
              />
              {passwordError && <p className="text-xs text-red-400">Incorrect password.</p>}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setShowPasswordDialog(false)} className="text-gray-400 hover:text-white">Cancel</Button>
              <Button size="sm" onClick={handlePasswordSubmit} className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700">Authorize & Push</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
