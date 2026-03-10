import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, Clock, ArrowRight } from "lucide-react";
import { EmptyState } from "../summaries/EmptyState";
import { Button } from "@/components/ui/button";
import { DepositionFactLoader } from "@/components/ui/DepositionFactLoader";
import type { Summary } from "../summaries/SummaryList";
import api from "@/lib/axios";

export const MainContent = ({ children }: { children?: React.ReactNode }) => {
  const navigate = useNavigate();
  const hasCustomContent = Boolean(children);

  const {
    data: summaries = [],
    isLoading,
    isError,
  } = useQuery<Summary[]>({
    queryKey: ["summaries"],
    queryFn: () => api.get<Summary[]>("/api/summaries").then((r) => r.data),
    staleTime: 5 * 60_000,
    refetchInterval: 10_000,
    enabled: !hasCustomContent,
  });

  const recentSummaries = useMemo(() => {
    if (!summaries?.length) return [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 3);

    return [...summaries]
      .filter((summary) => {
        const createdAt = new Date(summary.date);
        return !Number.isNaN(createdAt.getTime()) && createdAt >= cutoff;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 3);
  }, [summaries]);

  const hasSummaries = recentSummaries.length > 0;
  const hasArchivedSummaries = !hasSummaries && (summaries?.length ?? 0) > 0;

  const handleCreateSummary = () => {
    navigate("/create-summary");
  };

  const handleViewAllSummaries = () => {
    navigate("/summaries");
  };

  const handleSummaryNavigation = (summary: Summary) => {
    const targetTab =
      summary.status === "processing"
        ? "processing"
        : summary.status === "inactive"
        ? "inactive"
        : "active";

    navigate("/summaries", {
      state: {
        tab: targetTab,
        recentSummaryId: summary.id,
      },
    });
  };

  const statusStyles: Record<Summary["status"], string> = {
    active: "bg-emerald-100 text-emerald-700",
    processing: "bg-amber-100 text-amber-700",
    inactive: "bg-slate-200 text-slate-700",
    error: "bg-rose-100 text-rose-700",
  };

  const statusLabel: Record<Summary["status"], string> = {
    active: "Ready",
    processing: "Processing",
    inactive: "Expired",
    error: "Error",
  };

  // If children are provided, render them instead of the default content
  if (hasCustomContent) {
    return (
      <main className="flex-1 px-5 py-0 max-md:px-[15px] max-md:py-0 max-sm:px-2.5 max-sm:py-0">
        {children}
      </main>
    );
  }

  // Default content (for summary page)
  return (
    <main className="flex-1 px-5 py-0 max-md:px-[15px] max-md:py-0 max-sm:px-2.5 max-sm:py-0">
      <header className="flex justify-between items-center px-0 py-[29px] max-sm:flex-col max-sm:items-start max-sm:gap-5">
        <div className="max-w-[812px]">
          <h1 className="text-[28px] font-bold mb-[5px] max-sm:text-2xl text-slate-900 dark:text-slate-100">
            Summaries
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-300 max-w-[812px] max-sm:text-sm">
            Review the status of summaries and access completed summaries. Files
            are deleted after 3 days. Make sure to download completed files on
            the next screen.
          </p>
        </div>
        <button
          className="text-white text-[13px] font-medium cursor-pointer bg-[#5674BC] px-5 py-2.5 rounded-[5px] border-[none] max-sm:w-full hover:bg-[#4a65a7] transition-colors"
          onClick={handleCreateSummary}
        >
          Create summary
        </button>
      </header>

      <div className="w-64 h-px bg-[rgba(86,116,188,0.5)] dark:bg-slate-700 mx-0 my-0.5" />

      {isLoading ? (
        <DepositionFactLoader 
          message="Loading your recent summaries…" 
          fullScreen={false} 
          spinnerSize="sm"
        />
      ) : isError ? (
        <div className="mt-10 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-slate-900/70 p-8 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            We couldn't load your summaries
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Please refresh the page or open the summaries list to retry.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={handleViewAllSummaries}
          >
            Go to summaries
          </Button>
        </div>
      ) : hasSummaries ? (
        <section className="mt-8 space-y-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                Recent activity
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Track the latest deposition summaries we've generated for you.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handleViewAllSummaries}
              className="self-start"
            >
              View all summaries
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-4">
            {recentSummaries.map((summary) => {
              const totalPages =
                summary.totalPages && summary.totalPages > 0
                  ? summary.totalPages
                  : summary.lastPageProcessed ?? summary.pages ?? 0;

              return (
                <article
                  key={summary.id}
                  className="rounded-xl border border-white/60 dark:border-slate-700/60 bg-white/90 dark:bg-slate-900/70 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            statusStyles[summary.status]
                          }`}
                        >
                          {statusLabel[summary.status]}
                        </span>
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                          {new Date(summary.date).toLocaleString()}
                        </span>
                      </div>
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {summary.fileTitle || summary.fileName}
                      </h3>
                      <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                        <span className="inline-flex items-center gap-1">
                          <FileText className="h-4 w-4" />
                          {totalPages} page{totalPages === 1 ? "" : "s"}
                        </span>
                        {summary.timeMinutes != null && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            {summary.timeMinutes.toFixed(1)} mins processing
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Button
                        variant="secondary"
                        onClick={() => handleSummaryNavigation(summary)}
                      >
                        {summary.status === "processing"
                          ? "View status"
                          : "Open summary"}
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : hasArchivedSummaries ? (
        <section className="mt-8">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/70 p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              No recent summaries
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Summaries older than three (3) days are unavailable on the
              dashboard. Use the tab below to review a list of your archived
              deposition summaries.. Visit your summaries list to review
              archived depositions.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={handleViewAllSummaries}
            >
              Open summaries archive
            </Button>
          </div>
        </section>
      ) : (
        <EmptyState onCreate={handleCreateSummary} />
      )}
    </main>
  );
};
