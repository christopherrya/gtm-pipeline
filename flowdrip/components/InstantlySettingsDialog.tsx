"use client";
import { useState } from "react";
import { useCampaignStore } from "@/store/campaignStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Settings, Eye, EyeOff, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

const DAYS = [
  { key: "monday", label: "Mon" }, { key: "tuesday", label: "Tue" }, { key: "wednesday", label: "Wed" },
  { key: "thursday", label: "Thu" }, { key: "friday", label: "Fri" }, { key: "saturday", label: "Sat" }, { key: "sunday", label: "Sun" },
];

export default function InstantlySettingsDialog() {
  const { instantlyApiKey, setInstantlyApiKey, campaignSchedule, setCampaignSchedule } = useCampaignStore();
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);

  const handleTestConnection = async () => {
    if (!instantlyApiKey) { toast.error("Enter an API key first."); return; }
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch("/api/instantly/campaigns", { headers: { "x-instantly-key": instantlyApiKey } });
      if (res.ok) { setTestResult("success"); toast.success("Connected to Instantly!"); }
      else { setTestResult("error"); toast.error("Failed to connect."); }
    } catch { setTestResult("error"); toast.error("Network error."); }
    finally { setTesting(false); }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white"><Settings className="h-4 w-4" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-md border-[#333] bg-[#111] text-white">
        <DialogHeader><DialogTitle>Instantly Settings</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Label className="text-sm font-medium text-gray-300">API Key</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input type={showKey ? "text" : "password"} value={instantlyApiKey} onChange={(e) => { setInstantlyApiKey(e.target.value); setTestResult(null); }} placeholder="Enter your Instantly API key..." className="border-[#333] bg-[#1a1a1a] pr-10 text-white placeholder:text-gray-600" />
              <button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button size="sm" variant="outline" onClick={handleTestConnection} disabled={testing || !instantlyApiKey} className="border-[#333] text-gray-300 hover:text-white">
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : testResult === "success" ? <CheckCircle className="h-4 w-4 text-green-500" /> : testResult === "error" ? <XCircle className="h-4 w-4 text-red-500" /> : "Test"}
            </Button>
          </div>
          <p className="text-xs text-gray-500">Leave blank to use server-configured key.</p>
        </div>
        <Separator className="bg-[#333]" />
        <div className="space-y-3">
          <Label className="text-sm font-medium text-gray-300">Campaign Schedule</Label>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs text-gray-400">Start Date</Label><Input type="date" value={campaignSchedule.startDate} onChange={(e) => setCampaignSchedule({ startDate: e.target.value })} className="border-[#333] bg-[#1a1a1a] text-white" /></div>
            <div className="space-y-1"><Label className="text-xs text-gray-400">End Date</Label><Input type="date" value={campaignSchedule.endDate} onChange={(e) => setCampaignSchedule({ endDate: e.target.value })} className="border-[#333] bg-[#1a1a1a] text-white" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs text-gray-400">From</Label><Input type="time" value={campaignSchedule.fromTime} onChange={(e) => setCampaignSchedule({ fromTime: e.target.value })} className="border-[#333] bg-[#1a1a1a] text-white" /></div>
            <div className="space-y-1"><Label className="text-xs text-gray-400">To</Label><Input type="time" value={campaignSchedule.toTime} onChange={(e) => setCampaignSchedule({ toTime: e.target.value })} className="border-[#333] bg-[#1a1a1a] text-white" /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs text-gray-400">Timezone</Label><Input value={campaignSchedule.timezone} onChange={(e) => setCampaignSchedule({ timezone: e.target.value })} placeholder="America/New_York" className="border-[#333] bg-[#1a1a1a] text-white placeholder:text-gray-600" /></div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-400">Active Days</Label>
            <div className="flex gap-2">
              {DAYS.map((day) => (
                <label key={day.key} className="flex cursor-pointer flex-col items-center gap-1">
                  <Checkbox checked={campaignSchedule.days[day.key] ?? false} onCheckedChange={(checked) => setCampaignSchedule({ days: { ...campaignSchedule.days, [day.key]: !!checked } })} className="border-[#555] data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600" />
                  <span className="text-[10px] text-gray-400">{day.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
