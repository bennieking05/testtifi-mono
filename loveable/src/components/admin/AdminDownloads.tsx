// src/components/admin/AdminDownloads.tsx test 

import React from "react";
import api from "@/lib/axios";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

type DownloadMetrics = {
  totalDownloads: number;
  downloadsThisMonth: number;
  avgDownloadsPerSummary: number;
  byFormat?: Record<string, number>;
  topDownloaded?: Array<{
    title?: string;
    downloads: number;
  }>;
};

export const AdminDownloads: React.FC = () => {
  const {
    data: downloadMetrics,
    isLoading,
    isError,
  } = useQuery<DownloadMetrics, Error>({
    queryKey: ["downloadMetrics"],
    queryFn: async () => {
      const { data } = await api.get<DownloadMetrics>("/api/admin/metrics/downloads");
      return data;
    },
    staleTime: 5 * 60_000,
  });

  // CSV export
  const downloadCsv = () => {
    if (!downloadMetrics) return;
    
    const header = ["Metric", "Value"];
    const rows = [
      ["Total Downloads", downloadMetrics.totalDownloads],
      ["Downloads This Month", downloadMetrics.downloadsThisMonth],
      ["PDF Downloads", downloadMetrics.byFormat?.pdf || 0],
      ["DOCX Downloads", downloadMetrics.byFormat?.docx || 0],
      ["TXT Downloads", downloadMetrics.byFormat?.txt || 0],
      ["CSV Downloads", downloadMetrics.byFormat?.csv || 0],
    ];
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${c}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `download_metrics_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const byFormat = downloadMetrics?.byFormat;
  const topDownloaded = downloadMetrics?.topDownloaded ?? [];
  const topFormatLabel = React.useMemo(() => {
    if (!byFormat) return "N/A";
    const entries = Object.entries(byFormat);
    if (entries.length === 0) return "N/A";
    const [format] = entries.reduce<[string, number]>((maxEntry, currentEntry) =>
      currentEntry[1] > maxEntry[1] ? currentEntry : maxEntry,
      entries[0]
    );
    return format.toUpperCase();
  }, [byFormat]);

  if (isLoading) return <p>Loading download metrics…</p>;
  if (isError) return <p>Failed to load download metrics.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Download Metrics</h2>
        <Button onClick={downloadCsv} variant="outline">
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border">
          <h3 className="text-sm font-medium text-gray-500">Total Downloads</h3>
          <p className="text-2xl font-bold">{downloadMetrics?.totalDownloads || 0}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <h3 className="text-sm font-medium text-gray-500">This Month</h3>
          <p className="text-2xl font-bold">{downloadMetrics?.downloadsThisMonth || 0}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <h3 className="text-sm font-medium text-gray-500">Avg per Summary</h3>
          <p className="text-2xl font-bold">{downloadMetrics?.avgDownloadsPerSummary || 0}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <h3 className="text-sm font-medium text-gray-500">Top Format</h3>
          <p className="text-2xl font-bold">
            {topFormatLabel}
          </p>
        </div>
      </div>

      {/* Downloads by Format */}
      <div className="bg-white p-4 rounded-lg border">
        <h3 className="text-lg font-semibold mb-4">Downloads by Format</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {byFormat &&
            Object.entries(byFormat).map(([format, count]) => (
              <div key={format} className="text-center">
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-sm text-gray-500">{format.toUpperCase()}</p>
              </div>
            ))}
        </div>
      </div>

      {/* Top Downloaded Summaries */}
      {topDownloaded.length > 0 && (
        <div className="bg-white p-4 rounded-lg border">
          <h3 className="text-lg font-semibold mb-4">Top Downloaded Summaries</h3>
          <div className="space-y-2">
            {topDownloaded.map((item, index) => (
              <div key={index} className="flex justify-between items-center">
                <span className="font-medium">{item.title || 'Unknown'}</span>
                <span className="text-sm text-gray-500">{item.downloads} downloads</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};