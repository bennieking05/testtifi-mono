import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import api from "@/lib/axios";

type Config = {
  system: string;
  temperature: number;
  maxTokens: number;
};

export const PromptPlayground: React.FC = () => {
  const [cfg, setCfg] = useState<Config>({ system: "", temperature: 0.0, maxTokens: 3800 });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string>("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api.get<Config>("/api/summaries/prompt-config")
      .then((response) => {
        if (mounted) setCfg(response.data);
      })
      .catch(() => {})
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      await api.put("/api/summaries/prompt-config", cfg);
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(""), 1500);
    } catch (e: any) {
      setSaveMsg(e.response?.data?.error || e.message || "Error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompt Playground</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">System Instruction</label>
          <Textarea
            value={cfg.system}
            onChange={(e) => setCfg({ ...cfg, system: e.target.value })}
            rows={14}
            placeholder="System prompt used by the worker"
            disabled={loading || saving}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Temperature</label>
            <Input
              type="number"
              step="0.1"
              value={cfg.temperature}
              onChange={(e) => setCfg({ ...cfg, temperature: Number(e.target.value) })}
              disabled={loading || saving}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Max Tokens</label>
            <Input
              type="number"
              value={cfg.maxTokens}
              onChange={(e) => setCfg({ ...cfg, maxTokens: Number(e.target.value) })}
              disabled={loading || saving}
            />
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={loading || saving} className="bg-[#5674BC] hover:bg-[#4a65a7]">
          {saving ? "Saving…" : "Save"}
        </Button>
        {saveMsg && <span className="text-sm text-gray-600">{saveMsg}</span>}
      </CardFooter>
    </Card>
  );
};

export default PromptPlayground;




