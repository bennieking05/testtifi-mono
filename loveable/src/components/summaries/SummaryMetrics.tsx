import React from "react";
import { FileText, Clock, CreditCard, Activity, PiggyBank, Calendar, Loader2 } from "lucide-react";
import { Summary } from "@/components/summaries/SummaryList";

interface SummaryMetricsProps {
  summaries: Summary[];
  isLoading?: boolean;
}

export const SummaryMetrics: React.FC<SummaryMetricsProps> = ({
  summaries,
  isLoading = false,
}) => {
  const totalSummaries = summaries.length;
  const processingCount = summaries.filter(s => s.status === "processing").length;
  
  const now = new Date();
  const thisMonthCount = summaries.filter(s => {
    const d = new Date(s.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  // Calculate total pages safely handling undefined values
  const totalPages = summaries.reduce((acc, s) => {
    const p = s.totalPages || s.pages;
    // ensure p is a number
    return acc + (typeof p === 'number' ? p : 0);
  }, 0);

  // Estimate time saved: assume 5 mins per page manual reading/summarizing
  const timeSavedMinutes = totalPages * 5;
  const timeSavedHours = Math.floor(timeSavedMinutes / 60);
  const timeSavedMinsRemainder = timeSavedMinutes % 60;
  
  // Estimate money saved: assume $250/hr billable rate for attorney time saved
  const moneySaved = Math.round((timeSavedMinutes / 60) * 250);

  const stats = [
    {
      label: "Total Summaries",
      value: totalSummaries.toString(),
      icon: FileText,
      color: "text-blue-600",
      bg: "bg-blue-50 dark:bg-blue-900/20",
      borderColor: "border-blue-100 dark:border-blue-800",
    },
    {
      label: "Processing",
      value: processingCount.toString(),
      icon: processingCount > 0 ? Loader2 : Activity,
      iconClass: processingCount > 0 ? "animate-spin" : "",
      color: "text-yellow-600",
      bg: "bg-yellow-50 dark:bg-yellow-900/20",
      borderColor: "border-yellow-100 dark:border-yellow-800",
    },
    {
      label: "This Month",
      value: thisMonthCount.toString(),
      icon: Calendar,
      color: "text-emerald-600",
      bg: "bg-emerald-50 dark:bg-emerald-900/20",
      borderColor: "border-emerald-100 dark:border-emerald-800",
    },
    {
      label: "Time Saved",
      value: `${timeSavedHours}h ${timeSavedMinsRemainder}m`,
      icon: Clock,
      color: "text-purple-600",
      bg: "bg-purple-50 dark:bg-purple-900/20",
      borderColor: "border-purple-100 dark:border-purple-800",
    },
    {
      label: "Money Saved",
      value: `$${moneySaved.toLocaleString()}`,
      icon: PiggyBank,
      color: "text-green-600",
      bg: "bg-green-50 dark:bg-green-900/20",
      borderColor: "border-green-100 dark:border-green-800",
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-32 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={`p-4 rounded-xl bg-white dark:bg-slate-800 border ${stat.borderColor} shadow-sm flex flex-col justify-between transition-all hover:shadow-md h-full`}
        >
          <div className="flex justify-between items-start mb-2">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              {stat.label}
            </p>
            <div className={`p-2 rounded-lg ${stat.bg}`}>
              <stat.icon className={`w-4 h-4 ${stat.color} ${stat.iconClass || ''}`} />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
};
