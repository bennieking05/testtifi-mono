import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axios";
import { AuthenticatedLayout } from "@/components/layout/AuthenticatedLayout";
import { EmptyState } from "@/components/summaries/EmptyState";
import SummaryList, { Summary } from "@/components/summaries/SummaryList";
import { Button } from "@/components/ui/button";
import { EmailNotificationDialog } from "@/components/dialogs/EmailNotificationDialog";
import { ChevronDown, CalendarIcon, Download } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DepositionFactLoader } from "@/components/ui/DepositionFactLoader";
import { SummaryMetrics } from "@/components/summaries/SummaryMetrics";
import { SavingsChart } from "@/components/dashboard/SavingsChart";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format, parseISO, isWithinInterval, startOfDay, endOfDay, subDays, subMonths } from "date-fns";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";

type TabKey = "active" | "inactive" | "processing";
type TimeFilter = "all" | "year" | "6months" | "30days" | "7days" | "custom";

const TIME_FILTER_OPTIONS: { label: string; value: TimeFilter }[] = [
  { label: "All Time", value: "all" },
  { label: "Last 12 Months", value: "year" },
  { label: "Last 6 Months", value: "6months" },
  { label: "Last 30 Days", value: "30days" },
  { label: "Last 7 Days", value: "7days" },
  { label: "Custom Range", value: "custom" },
];

function parseDateSafe(str: string): Date {
  const ts = Date.parse(str);
  return isNaN(ts) ? new Date() : new Date(ts);
}

const Summaries: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [activeTab, setActiveTab] = useState<TabKey>("active");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [showProcessingNotice, setShowProcessingNotice] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailDialogSummaryId, setEmailDialogSummaryId] = useState<string>("");
  const [emailDialogSummaryName, setEmailDialogSummaryName] = useState<string>("");

  // Filter state
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [filterDeponents, setFilterDeponents] = useState<string[]>([]);
  const [filterCases, setFilterCases] = useState<string[]>([]);

  const {
    data: allSummaries = [],
    isLoading,
    refetch,
  } = useQuery<Summary[]>({
    queryKey: ["summaries"],
    queryFn: () => api.get<Summary[]>("/api/summaries").then((r) => r.data),
    staleTime: 5 * 60_000,
    refetchInterval: 10_000,
  });

  // Get unique values for filters
  const uniqueDeponents = useMemo(() => {
    const names = new Set<string>();
    allSummaries.forEach((s) => {
      if (s.deponentName) names.add(s.deponentName);
    });
    return Array.from(names).sort();
  }, [allSummaries]);

  const uniqueCases = useMemo(() => {
    const cases = new Set<string>();
    allSummaries.forEach((s) => {
      if (s.caseTitle) cases.add(s.caseTitle);
    });
    return Array.from(cases).sort();
  }, [allSummaries]);

  // Apply filters
  const filteredSummaries = useMemo(() => {
    const now = new Date();
    return allSummaries.filter((s) => {
      const summaryDate = parseDateSafe(s.date);

      // Time filter
      switch (timeFilter) {
        case "7days":
          if (!isWithinInterval(summaryDate, { start: startOfDay(subDays(now, 7)), end: endOfDay(now) })) return false;
          break;
        case "30days":
          if (!isWithinInterval(summaryDate, { start: startOfDay(subDays(now, 30)), end: endOfDay(now) })) return false;
          break;
        case "6months":
          if (!isWithinInterval(summaryDate, { start: startOfDay(subMonths(now, 6)), end: endOfDay(now) })) return false;
          break;
        case "year":
          if (!isWithinInterval(summaryDate, { start: startOfDay(subMonths(now, 12)), end: endOfDay(now) })) return false;
          break;
        case "custom":
          if (dateRange?.from && dateRange?.to) {
            if (!isWithinInterval(summaryDate, { start: startOfDay(dateRange.from), end: endOfDay(dateRange.to) })) return false;
          }
          break;
      }

      // Deponent filter
      if (filterDeponents.length > 0 && !filterDeponents.includes(s.deponentName || "")) {
        return false;
      }

      // Case filter
      if (filterCases.length > 0 && !filterCases.includes(s.caseTitle || "")) {
        return false;
      }

      return true;
    });
  }, [allSummaries, timeFilter, dateRange, filterDeponents, filterCases]);

  const handleTimeFilterChange = (value: TimeFilter) => {
    setTimeFilter(value);
    if (value !== "custom") {
      setDateRange(undefined);
    }
  };

  const handleDateRangeSelect = (range: DateRange | undefined) => {
    setDateRange(range);
    if (range?.from && range?.to) {
      setTimeFilter("custom");
      setCalendarOpen(false);
    }
  };

  const toggleFilter = (
    value: string,
    current: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setter(current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);
  };

  // CSV export
  const downloadCsv = () => {
    const header = ["Deponent", "Case Title", "Date", "Status", "Pages"];
    const rows = filteredSummaries.map((s) => [
      s.deponentName || "Unknown",
      s.caseTitle || "",
      format(parseDateSafe(s.date), "MMM d, yyyy"),
      s.status,
      s.totalPages || s.pages || 0,
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `summaries_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalCount = filteredSummaries.length;

  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const processingSummaries = filteredSummaries.filter((s) => s.status === "processing");
  const activeSummaries = filteredSummaries.filter(
    (s) => s.status === "active" && parseDateSafe(s.date) >= threeDaysAgo
  );
  const inactiveSummaries = filteredSummaries.filter(
    (s) => s.status === "active" && parseDateSafe(s.date) < threeDaysAgo
  );

  function normalize(tab?: string): TabKey {
    return tab === "processing" || tab === "active" ? (tab as TabKey) : "inactive";
  }

  useEffect(() => {
    const st = (location.state as any) ?? {};
    if (st.tab) setActiveTab(normalize(st.tab));
    if (st.recentSummaryId) {
      setHighlightId(st.recentSummaryId);
      if (st.tab === "processing") setShowProcessingNotice(true);
      refetch();
      if (st.promptEmail) {
        setEmailDialogSummaryId(st.recentSummaryId);
        setEmailDialogSummaryName(st.summaryName || "Your deposition summary");
        setEmailDialogOpen(true);
      }
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, navigate, location.pathname]);

  useEffect(() => {
    if (processingSummaries.length === 0) {
      setShowProcessingNotice(false);
    }
  }, [processingSummaries.length]);

  const handleCreate = () => navigate("/create-summary");

  const hasSummaries = totalCount > 0;
  const hasRecentSummaries = activeSummaries.length > 0 || processingSummaries.length > 0;
  const activeTimeLabel = TIME_FILTER_OPTIONS.find((o) => o.value === timeFilter)?.label || "All Time";

  return (
    <TooltipProvider>
      <AuthenticatedLayout>
        <main className="flex-1 px-5 py-0 max-md:px-[15px] max-md:py-0 max-sm:px-2.5 max-sm:py-0">
          <header className="flex justify-between items-center px-0 py-[29px] max-sm:flex-col max-sm:items-start max-sm:gap-5">
            <div className="max-w-[812px]">
              <h1 className="text-[28px] font-bold mb-[5px] max-sm:text-2xl text-slate-900 dark:text-slate-100">
                Summaries
              </h1>
              <p className="text-base text-slate-600 dark:text-slate-300 max-w-[812px] max-sm:text-sm">
                Review the status of summaries and access completed summaries.
                Files are deleted after 3 days. Make sure to download completed
                files on the next screen.
              </p>
            </div>
            <button
              className="text-white text-[13px] font-medium cursor-pointer bg-[#5674BC] px-5 py-2.5 rounded-[5px] border-[none] max-sm:w-full hover:bg-[#4a65a7] transition-colors"
              onClick={handleCreate}
            >
              Create summary
            </button>
          </header>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 sm:gap-3 mb-6 overflow-x-auto pb-2">
            {/* Time Filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="min-w-[110px] sm:min-w-[130px] justify-between text-xs sm:text-sm whitespace-nowrap">
                  {activeTimeLabel}
                  <ChevronDown className="ml-1 sm:ml-2 h-3 w-3 sm:h-4 sm:w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Time Range</DropdownMenuLabel>
                {TIME_FILTER_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt.value}
                    onClick={() => handleTimeFilterChange(opt.value)}
                    className={cn(timeFilter === opt.value && "bg-slate-100 dark:bg-slate-700")}
                  >
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Date Range Picker */}
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn("min-w-[140px] sm:min-w-[180px] justify-start text-left font-normal text-xs sm:text-sm whitespace-nowrap", !dateRange && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <span className="truncate">
                        {format(dateRange.from, "MMM d")} - {format(dateRange.to, "MMM d")}
                      </span>
                    ) : (
                      format(dateRange.from, "MMM d, yyyy")
                    )
                  ) : (
                    "Select dates"
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  defaultMonth={dateRange?.from}
                  selected={dateRange}
                  onSelect={handleDateRangeSelect}
                  numberOfMonths={2}
                  disabled={{ after: new Date() }}
                />
              </PopoverContent>
            </Popover>

            {/* Deponent Filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs sm:text-sm whitespace-nowrap">
                  <span className="hidden sm:inline">Deponents</span>
                  <span className="sm:hidden">Dep.</span>
                  <span className="ml-1">({filterDeponents.length || "All"})</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-64 overflow-y-auto">
                <DropdownMenuLabel>Filter by Deponent</DropdownMenuLabel>
                {uniqueDeponents.map((d) => (
                  <DropdownMenuCheckboxItem
                    key={d}
                    checked={filterDeponents.includes(d)}
                    onCheckedChange={() => toggleFilter(d, filterDeponents, setFilterDeponents)}
                  >
                    {d}
                  </DropdownMenuCheckboxItem>
                ))}
                {uniqueDeponents.length === 0 && (
                  <DropdownMenuItem disabled>No deponents found</DropdownMenuItem>
                )}
                {filterDeponents.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setFilterDeponents([])}>Clear</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Case Filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs sm:text-sm whitespace-nowrap">
                  Cases ({filterCases.length || "All"})
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-64 overflow-y-auto">
                <DropdownMenuLabel>Filter by Case</DropdownMenuLabel>
                {uniqueCases.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c}
                    checked={filterCases.includes(c)}
                    onCheckedChange={() => toggleFilter(c, filterCases, setFilterCases)}
                  >
                    {c}
                  </DropdownMenuCheckboxItem>
                ))}
                {uniqueCases.length === 0 && (
                  <DropdownMenuItem disabled>No cases found</DropdownMenuItem>
                )}
                {filterCases.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setFilterCases([])}>Clear</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Export */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs sm:text-sm whitespace-nowrap">
                  <Download className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">Export</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Select Format</DropdownMenuLabel>
                <DropdownMenuItem onClick={downloadCsv}>CSV (.csv)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <p className="text-xs sm:text-sm text-slate-500 mb-4">
            Showing {filteredSummaries.length.toLocaleString()} of {allSummaries.length.toLocaleString()} summaries
          </p>

          <SummaryMetrics summaries={filteredSummaries} isLoading={isLoading} />

          <SavingsChart summaries={filteredSummaries} isLoading={isLoading} />

          <div className="w-64 h-px bg-[rgba(86,116,188,0.5)] dark:bg-slate-700 mx-0 my-6" />

          {showProcessingNotice && (
            <DepositionFactLoader 
              message="Processing Your Deposition — Your summary will appear here when ready."
              fullScreen={false}
              spinnerSize="sm"
            />
          )}

          {isLoading ? (
            <DepositionFactLoader 
              message="Loading your summaries…"
              fullScreen={false}
              spinnerSize="sm"
            />
          ) : hasSummaries ? (
            hasRecentSummaries || activeTab === "inactive" ? (
              <div className="mt-8">
                <SummaryList
                  activeTab={activeTab}
                  highlightId={highlightId}
                  summaries={{
                    active: activeSummaries,
                    inactive: inactiveSummaries,
                    processing: processingSummaries,
                  }}
                />
              </div>
            ) : (
              <>
                <div className="mt-8">
                  <EmptyState onCreate={handleCreate} />
                </div>
                <section className="mt-8">
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/70 p-8 text-center shadow-sm">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                      No recent summaries
                    </h2>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      Summaries older than three (3) days are unavailable on the
                      dashboard. Use the tab below to review a list of your
                      archived deposition summaries. Visit your summaries list
                      to review archived depositions.
                    </p>
                    <Button variant="outline" className="mt-4" onClick={() => setActiveTab("inactive")}>
                      Open summaries archive
                    </Button>
                  </div>
                </section>
              </>
            )
          ) : (
            <div className="mt-8">
              <EmptyState onCreate={handleCreate} />
            </div>
          )}
          <EmailNotificationDialog
            open={emailDialogOpen}
            onOpenChange={setEmailDialogOpen}
            summaryId={emailDialogSummaryId}
            summaryName={emailDialogSummaryName}
          />
        </main>
      </AuthenticatedLayout>
    </TooltipProvider>
  );
};

export default Summaries;
