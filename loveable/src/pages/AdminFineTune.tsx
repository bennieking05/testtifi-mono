import React, { useEffect, useMemo, useState } from "react";
import { AuthenticatedLayout } from "@/components/layout/AuthenticatedLayout";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import FileUploader from "@/components/dashboard/FileUploader";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  BookOpen,
  Brain,
  Clock,
  Upload,
  AlertCircle,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axios";

const AdminFineTune = () => {
  const { toast } = useToast();
  const [pairInstructions, setPairInstructions] = useState("");
  const [files, setFiles] = useState<{
    humanSummary?: File;
    trainingPair?: File;
    transcript?: File;
    summaryForPairs?: File;
  }>({});
  const [trainingHistory, setTrainingHistory] = useState<any[]>([]);
  const [inFlightAction, setInFlightAction] = useState<string | null>(null);

  const isDevOrStaging = useMemo(() => {
    const apiUrl = import.meta.env.VITE_API_URL ?? "";
    // Allow staging or localhost/local development
    return /staging/i.test(apiUrl) || /localhost|127\.0\.0\.1|^\/api$/.test(apiUrl) || import.meta.env.DEV;
  }, []);

  const { data: promptConfig } = useQuery({
    queryKey: ["prompt-config"],
    queryFn: async () => {
      const { data } = await api.get("/api/summaries/prompt-config", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      return data as { system: string; temperature: number; maxTokens: number };
    },
    enabled: isDevOrStaging,
    staleTime: 5 * 60_000,
  });

  const refreshHistory = async () => {
    try {
      const { data } = await api.get("/api/fine-tune/history", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      setTrainingHistory(data);
    } catch (err) {
      console.error("Failed to fetch training history", err);
    }
  };

  useEffect(() => {
    if (!isDevOrStaging) return;
    refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDevOrStaging]);

  const handleUpload = async (type: "human_summary" | "training_pair") => {
    // Map API type to state property name
    const fileKey = type === "human_summary" ? "humanSummary" : "trainingPair";
    const file = files[fileKey];
    if (!file) {
      toast({ title: "No file selected", variant: "destructive" });
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
      setInFlightAction(type);
      const endpoint =
        type === "human_summary"
          ? "/api/fine-tune/upload-human-summary"
          : "/api/fine-tune/upload-training-pair";
      await api.post(endpoint, formData, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      await refreshHistory();
      toast({
        title: "Upload complete",
        description: `${type} uploaded successfully.`,
      });
    } catch (err) {
      console.error(err);
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setInFlightAction(null);
    }
  };

  const handleGeneratePairs = async () => {
    const { transcript, summaryForPairs } = files;
    if (!transcript || !summaryForPairs) {
      toast({
        title: "Missing files",
        description: "Upload both a transcript and a human summary before generating pairs.",
        variant: "destructive",
      });
      return;
    }

    const formData = new FormData();
    formData.append("transcript", transcript);
    formData.append("summary", summaryForPairs);
    formData.append("instructions", pairInstructions);

    try {
      setInFlightAction("generate");
      await api.post("/api/fine-tune/generate-pairs", formData, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      await refreshHistory();
      toast({
        title: "Pair generation started",
        description: "Aligning human summaries with transcripts.",
      });
    } catch (err) {
      toast({ title: "Error generating pairs", variant: "destructive" });
    } finally {
      setInFlightAction(null);
    }
  };

  if (!isDevOrStaging) {
    return (
      <AuthenticatedLayout>
        <main className="flex-1 px-5 py-10">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-amber-500" />
                Fine-tuning tools unavailable
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                These tools are only available in staging and local development environments.
                Deploy to staging or run locally and sign in with your admin account to manage training assets and prompts.
              </p>
            </CardContent>
          </Card>
        </main>
      </AuthenticatedLayout>
    );
  }

  return (
    <AuthenticatedLayout>
      <main className="flex-1 px-5 py-10">
        <div className="flex flex-col gap-2 mb-6">
          <h1 className="text-2xl font-bold">Training Assets & Fine-Tuning</h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Manage the assets and configuration that power deposition summaries. All actions
            are routed through the staging API with admin credentials.
          </p>
        </div>

        {promptConfig && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-[#5674BC]" />
                Current summarization prompt
              </CardTitle>
              <CardDescription>
                Pulled directly from the backend configuration file.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-600">
                  System instruction
                </label>
                <Textarea value={promptConfig.system} readOnly className="mt-1 h-48 resize-none" />
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Temperature</p>
                  <p className="text-lg font-semibold">{promptConfig.temperature}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Max tokens</p>
                  <p className="text-lg font-semibold">{promptConfig.maxTokens}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText /> Human-Written Summary
              </CardTitle>
              <CardDescription>
                Upload a manually created deposition summary for training
                alignment.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FileUploader
                onFileUpload={(f) =>
                  setFiles((prev) => ({ ...prev, humanSummary: f }))
                }
                acceptExtensions={[".pdf", ".doc", ".docx", ".txt"]}
                helperText="PDF, DOC, DOCX, TXT"
              />
              <Button
                className="mt-4 w-full"
                onClick={() => handleUpload("human_summary")}
                disabled={inFlightAction === "human_summary"}
              >
                {inFlightAction === "human_summary" ? "Uploading…" : "Upload to /human"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload /> Training Pair JSONL
              </CardTitle>
              <CardDescription>
                Upload pre-aligned training data to fine-tune the model.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FileUploader
                onFileUpload={(f) =>
                  setFiles((prev) => ({ ...prev, trainingPair: f }))
                }
                acceptExtensions={[".jsonl", ".json"]}
                helperText=".jsonl or .json"
              />
              <Button
                className="mt-4 w-full"
                onClick={() => handleUpload("training_pair")}
                disabled={inFlightAction === "training_pair"}
              >
                {inFlightAction === "training_pair" ? "Uploading…" : "Upload to /pairs"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain /> Generate Training Pairs
              </CardTitle>
              <CardDescription>
                Automatically align transcripts and summaries into training
                JSONL format.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <FileUploader
                  onFileUpload={(f) =>
                    setFiles((prev) => ({ ...prev, transcript: f }))
                  }
                  acceptExtensions={[".pdf", ".doc", ".docx", ".txt"]}
                  helperText="Transcript: PDF, DOC, DOCX, TXT"
                />
                <FileUploader
                  onFileUpload={(f) =>
                    setFiles((prev) => ({ ...prev, summaryForPairs: f }))
                  }
                  acceptExtensions={[".pdf", ".doc", ".docx", ".txt"]}
                  helperText="Human summary: PDF, DOC, DOCX, TXT"
                />
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Instructions (optional)
                  </label>
                  <Textarea
                    value={pairInstructions}
                    onChange={(e) => setPairInstructions(e.target.value)}
                    placeholder="Guidance to include in the generated JSONL file…"
                  />
                </div>
              </div>
              <Button
                className="mt-4 w-full bg-green-600 hover:bg-green-700"
                onClick={handleGeneratePairs}
                disabled={inFlightAction === "generate"}
              >
                {inFlightAction === "generate" ? "Submitting…" : "Generate Pairs from Human Summaries"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Training History Table */}
        <Card className="mt-10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-[#5674BC]" />
              Training History
            </CardTitle>
            <CardDescription>
              Past model training sessions and their results
            </CardDescription>
          </CardHeader>
          <CardContent>
            {trainingHistory.length === 0 ? (
              <p className="text-sm text-gray-500">No history found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Filename</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trainingHistory.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell>
                        {new Date(session.uploadedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            session.type === "generated_pair"
                              ? "bg-green-100 text-green-800"
                              : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {session.type.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                        </span>
                      </TableCell>
                      <TableCell>{session.filename}</TableCell>
                      <TableCell>{session.description || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </AuthenticatedLayout>
  );
};

export default AdminFineTune;
