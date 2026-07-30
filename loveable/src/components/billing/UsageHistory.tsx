import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBillingLedger, type LedgerEntry } from "@/hooks/useBillingLedger";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon, ExternalLink, FileText, Download } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import api from "@/lib/axios";

export const UsageHistory: React.FC = () => {
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const cursorRef = useRef<string | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [displayBalance, setDisplayBalance] = useState<number>(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pageSizes, setPageSizes] = useState<number[]>([]);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<boolean>(false);
  const loadModeRef = useRef<"more" | null>(null);

  const { data, loading, error } = useBillingLedger({
    type: typeFilter,
    from: fromDate ? fromDate.toISOString() : undefined,
    to: toDate ? toDate.toISOString() : undefined,
    cursor: cursorRef.current,
    refreshKey,
  });

  useEffect(() => {
    loadModeRef.current = null;
    cursorRef.current = undefined;
    setRefreshKey((key) => key + 1);
    setEntries([]);
    setPageSizes([]);
    setCursorHistory([]);
    setNextCursor(null);
    setDownloadError(null);
  }, [typeFilter, fromDate, toDate]);

  const calculateRunningBalance = (
    startBalance: number,
    list: LedgerEntry[],
    currentIndex: number
  ) => {
    let balance = startBalance;
    for (let i = 0; i < currentIndex; i++) {
      balance -= list[i].credits;
    }
    return balance;
  };

  // Expirations/refunds are stored as "credit" rows; show the derived display
  // type so a −50 expiry never reads as "Credit −50" (UAT Round 48).
  const getDisplayType = (entry: LedgerEntry) =>
    entry.displayType ??
    (entry.expired ? "expired" : entry.refund ? "refund" : entry.type);

  const getTypeLabel = (entry: LedgerEntry) => {
    const type = getDisplayType(entry);
    switch (type) {
      case "expired":
        return "Expired";
      case "refund":
        return "Refund";
      default:
        return type.charAt(0).toUpperCase() + type.slice(1);
    }
  };

  const getTypeColor = (entry: LedgerEntry) => {
    switch (getDisplayType(entry)) {
      case "credit":
      case "refund":
        return "text-green-600";
      case "debit":
        return "text-red-600";
      case "expired":
        return "text-amber-600";
      case "adjustment":
        return "text-blue-600";
      default:
        return "";
    }
  };

  const getCreditsDisplay = (credits: number) => {
    const displayValue = Math.abs(credits).toLocaleString();
    return credits >= 0 ? `+${displayValue}` : `-${displayValue}`;
  };

  const getDescription = (entry: LedgerEntry) => {
    const type = getDisplayType(entry);
    if (type === "debit") {
      return `Summary generated: ${entry.description || "Deposition summary"}`;
    }
    if (type === "refund") {
      return entry.description || "Refund for failed summary";
    }
    return entry.description;
  };

  useEffect(() => {
    if (!data) return;

    if (loadModeRef.current === "more") {
      if (data.entries.length) {
        setEntries((prev) => [...prev, ...data.entries]);
        setPageSizes((prev) => [...prev, data.entries.length]);
      } else {
        setCursorHistory((prev) => prev.slice(0, -1));
      }
      loadModeRef.current = null;
    } else {
      setEntries(data.entries);
      setPageSizes([data.entries.length]);
      setCursorHistory([]);
      setDisplayBalance(data.balance);
    }

    if (loadModeRef.current !== "more") {
      setDisplayBalance(data.balance);
    }

    setNextCursor(data.nextCursor ?? null);
  }, [data]);

  useEffect(() => {
    if (!error) return;
    if (loadModeRef.current === "more") {
      setCursorHistory((prev) => prev.slice(0, -1));
      cursorRef.current = undefined;
      loadModeRef.current = null;
    }
  }, [error]);

  if (loading && !data) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-20 bg-muted rounded"></div>
        <div className="h-64 bg-muted rounded"></div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const handleLoadMore = () => {
    if (!nextCursor || loading) return;
    setDownloadError(null);
    loadModeRef.current = "more";
    setCursorHistory((prev) => [...prev, nextCursor]);
    cursorRef.current = nextCursor;
    setRefreshKey((key) => key + 1);
  };

  const handleLoadPrevious = () => {
    setDownloadError(null);
    setPageSizes((prev) => {
      if (prev.length <= 1) return prev;
      const lastSize = prev[prev.length - 1];
      setEntries((entriesState) => entriesState.slice(0, entriesState.length - lastSize));
      setCursorHistory((stack) => {
        if (!stack.length) {
          setNextCursor(null);
          cursorRef.current = undefined;
          return stack;
        }
        const newStack = stack.slice(0, -1);
        const popped = stack[stack.length - 1];
        setNextCursor(popped ?? null);
        cursorRef.current = undefined;
        return newStack;
      });
      return prev.slice(0, -1);
    });
  };

  const handleExportCsv = async () => {
    try {
      setDownloadError(null);
      setExporting(true);
      // Shared axios client: adds the Bearer token and 401-refresh automatically.
      const params: Record<string, string> = {};
      if (typeFilter && typeFilter !== "all") params.type = typeFilter;
      if (fromDate) params.from = fromDate.toISOString();
      if (toDate) params.to = toDate.toISOString();

      const response = await api.get("/api/billing/history", {
        params,
        headers: { Accept: "text/csv" },
        responseType: "blob",
      });

      const blob = response.data as Blob;
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `billing-usage-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Failed to download CSV");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Current Balance */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Available Credits</p>
              <p className="text-3xl font-bold text-primary">{displayBalance.toLocaleString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">Type</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="credit">Credits</SelectItem>
                  <SelectItem value="debit">Debits</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="refund">Refunds</SelectItem>
                  <SelectItem value="adjustment">Adjustments</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">From Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !fromDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {fromDate ? format(fromDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={fromDate}
                    onSelect={setFromDate}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">To Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !toDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {toDate ? format(toDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={toDate}
                    onSelect={setToDate}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">Error loading usage history: {error}</p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Showing {entries.length.toLocaleString()} entr{entries.length === 1 ? "y" : "ies"}
        </p>
        <div className="flex items-center gap-3">
          {downloadError && (
            <span className="text-sm text-destructive">{downloadError}</span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={exporting || (!entries.length && !loading)}
          >
            <Download className="h-4 w-4 mr-2" />
            {exporting ? "Preparing..." : "Export CSV"}
          </Button>
        </div>
      </div>

      {/* Usage Table */}
      {entries.length === 0 ? (
        <Card>
          <CardContent className="pt-12 pb-12 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No usage history yet</h3>
            <p className="text-muted-foreground mb-4">
              Start creating summaries to see your credit usage here.
            </p>
            <Button onClick={() => navigate("/create-summary")}>
              Generate Your First Summary
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium">Date</th>
                    <th className="text-left py-3 px-4 font-medium">Type</th>
                    <th className="text-right py-3 px-4 font-medium">Credits</th>
                    <th className="text-left py-3 px-4 font-medium">Description</th>
                    <th className="text-left py-3 px-4 font-medium">Source</th>
                    <th className="text-right py-3 px-4 font-medium">Balance after</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, index) => {
                    const runningBalance = calculateRunningBalance(displayBalance, entries, index);
                    return (
                      <tr key={entry.id} className="border-b hover:bg-muted/50">
                        <td className="py-3 px-4 text-sm">
                          {format(new Date(entry.createdAt), "MMM dd, yyyy HH:mm")}
                        </td>
                        <td className="py-3 px-4">
                          <span className={cn("text-sm font-medium", getTypeColor(entry))}>
                            {getTypeLabel(entry)}
                          </span>
                        </td>
                        <td className={cn("py-3 px-4 text-right font-mono font-semibold", getTypeColor(entry))}>
                          {getCreditsDisplay(entry.credits)}
                        </td>
                        <td className="py-3 px-4 text-sm space-y-1">
                          <div>{getDescription(entry)}</div>
                          {(entry.expired ||
                            entry.description?.toLowerCase().includes("expired unused credits")) && (
                            <Badge variant="destructive" className="text-xs">
                              Expired
                            </Badge>
                          )}
                          {entry.summaryId && (
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0"
                              onClick={() => navigate(`/summaries/${entry.summaryId}`)}
                            >
                              <FileText className="h-3 w-3 mr-1" />
                              View summary
                            </Button>
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm">
                          {(entry.purchase || (entry.allocations?.length ?? 0) > 0) && (
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0"
                              onClick={() => navigate("/billing?tab=purchases")}
                            >
                              <ExternalLink className="h-3 w-3 mr-1" />
                              View purchase
                            </Button>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-sm">
                          {runningBalance.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              "Balance after" shows your credit balance immediately after each transaction
              (newest first). Unused credits expire 3 days after purchase — expired rows
              remove them from your balance, so once all credits expire your balance is 0.
            </p>

            <div className="mt-6 flex flex-col sm:flex-row sm:justify-between gap-3 sm:items-center">
              <Button
                variant="outline"
                onClick={handleLoadPrevious}
                disabled={pageSizes.length <= 1 || loading}
              >
                Load Previous
              </Button>
              {nextCursor && (
                <Button
                  variant="outline"
                  onClick={handleLoadMore}
                  disabled={loading}
                >
                  Load More
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
