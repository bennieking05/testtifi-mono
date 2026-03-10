
// src/pages/SummaryDetail.tsx

import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "@/lib/axios";
import { Sidebar } from "@/components/layout/Sidebar";
import { DepositionFactLoader } from "@/components/ui/DepositionFactLoader";

interface SummaryDetailData {
  title: string;
  summary: string;
  createdAt: string;
}

const SummaryDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [summary, setSummary] = useState<SummaryDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [displayPages, setDisplayPages] = useState<number | null>(null);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const response = await api.get(`/api/summaries/view?id=${id}`);
        setSummary(response.data);

        // Also fetch the job list to get canonical totalPages for this summary
        try {
          const list = await api.get(`/api/summaries`);
          const job = Array.isArray(list.data)
            ? list.data.find((j: any) => j.id === id)
            : null;
          if (job) {
            const total =
              (typeof job.totalPages === "number" && job.totalPages > 0
                ? job.totalPages
                : job.lastPageProcessed) ?? null;
            setDisplayPages(total);
          }
        } catch (e) {
          // ignore list fetch errors; UI will still render without page count
        }
      } catch (error) {
        console.error("Error fetching summary:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, [id]);

  if (loading) {
    return <DepositionFactLoader message="Loading summary..." />;
  }

  if (!summary) {
    return (
      <div className="flex items-center justify-center h-screen text-red-600 dark:text-red-400 bg-white dark:bg-slate-900">
        Summary not found.
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-white dark:bg-slate-900">
      <Sidebar />
      <main className="flex-1 p-8">
        <h1 className="text-2xl font-bold mb-2 text-slate-900 dark:text-slate-100">{summary.title}</h1>
        <p className="text-gray-500 dark:text-slate-400 mb-4">
          {new Date(summary.createdAt).toLocaleString()}
          {typeof displayPages === "number" ? ` — ${displayPages} pages` : ""}
        </p>
        <div 
          className="summary-content prose max-w-none text-slate-900 dark:text-slate-100"
          dangerouslySetInnerHTML={{
            __html: summary.summary
              .replace(/\n/g, '<br/>')
              .replace(/<table>/g, '<table class="border-collapse border border-gray-300 w-full">')
              .replace(/<th>/g, '<th class="border border-gray-300 bg-gray-100 px-3 py-2 font-semibold">')
              .replace(/<td>/g, '<td class="border border-gray-300 px-3 py-2">')
          }}
          style={{
            fontFamily: 'monospace',
            fontSize: '14px',
            lineHeight: '1.4'
          }}
        />
      </main>
    </div>
  );
};

export default SummaryDetail;
