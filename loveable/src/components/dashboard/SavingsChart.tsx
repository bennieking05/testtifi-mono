import React from "react";
import { TrendingUp, DollarSign } from "lucide-react";
import { Summary } from "@/components/summaries/SummaryList";

interface SavingsChartProps {
  summaries: Summary[];
  isLoading?: boolean;
}

export const SavingsChart: React.FC<SavingsChartProps> = ({
  summaries,
  isLoading = false,
}) => {
  // Group summaries by month, then build cumulative savings so the trend rises over time
  const monthlyData = React.useMemo(() => {
    const grouped: Record<string, { count: number; pages: number }> = {};

    summaries.forEach((s) => {
      const date = new Date(s.date);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      if (!grouped[key]) {
        grouped[key] = { count: 0, pages: 0 };
      }
      grouped[key].count += 1;
      grouped[key].pages += s.totalPages || s.pages || 0;
    });

    const sorted = Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6); // Last 6 months

    let runningSavings = 0;
    return sorted.map(([month, data]) => {
      const monthSavings = Math.round(data.pages * 20.83); // 5 min/page * $250/hr
      runningSavings += monthSavings;
      return {
        month: new Date(month + "-01").toLocaleDateString("en-US", { month: "short" }),
        summaries: data.count,
        pages: data.pages,
        savings: monthSavings,
        cumulative: runningSavings,
      };
    });
  }, [summaries]);

  const totalSavings = monthlyData.length > 0 ? monthlyData[monthlyData.length - 1].cumulative : 0;
  const maxCumulative = Math.max(...monthlyData.map((d) => d.cumulative), 1);

  if (isLoading) {
    return (
      <div className="p-6 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm mb-6">
        <div className="h-48 animate-pulse bg-slate-100 dark:bg-slate-700 rounded-lg" />
      </div>
    );
  }

  if (monthlyData.length === 0) {
    return null; // Don't show chart if no data
  }

  return (
    <div className="p-6 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <TrendingUp className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Estimated Savings Trend
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Based on attorney time saved at $250/hr
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-green-600 font-bold text-xl">
          <DollarSign className="w-5 h-5" />
          {totalSavings.toLocaleString()}
          <span className="text-sm font-normal text-slate-500 ml-1">total</span>
        </div>
      </div>

      {/* Bar chart: cumulative savings so the trend rises left-to-right */}
      <div className="flex items-end gap-2 h-32 mt-4">
        {monthlyData.map((data) => (
          <div key={data.month} className="flex-1 flex flex-col items-center">
            <div
              className="w-full bg-gradient-to-t from-green-500 to-green-400 rounded-t-md transition-all hover:from-green-600 hover:to-green-500"
              style={{
                height: `${(data.cumulative / maxCumulative) * 100}%`,
                minHeight: data.cumulative > 0 ? "8px" : "0px",
              }}
              title={`$${data.cumulative.toLocaleString()} cumulative`}
            />
            <span className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              {data.month}
            </span>
          </div>
        ))}
      </div>

      <div className="flex justify-center gap-6 mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
        <div className="text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">Summaries</p>
          <p className="font-semibold text-slate-900 dark:text-slate-100">
            {monthlyData.reduce((acc, d) => acc + d.summaries, 0)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">Pages Processed</p>
          <p className="font-semibold text-slate-900 dark:text-slate-100">
            {monthlyData.reduce((acc, d) => acc + d.pages, 0).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
};
