import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import api from "@/lib/axios";
import { AuthenticatedLayout } from "@/components/layout/AuthenticatedLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Filter, RefreshCw } from "lucide-react";
import { DateRange } from "react-day-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";

type LedgerType = "credit" | "debit" | "adjustment" | "all";

interface AllocationDTO {
  id: string;
  debitLedgerId: string;
  purchaseId: string;
  creditsUsed: number;
  purchase?: {
    id: string;
    stripePaymentIntentId: string | null;
    createdAt: string;
  };
}

interface LedgerEntryDTO {
  id: string;
  userId: string;
  type: "credit" | "debit" | "adjustment";
  credits: number;
  summaryId: string | null;
  description: string | null;
  createdAt: string;
  purchase?: {
    id: string;
    stripePaymentIntentId: string | null;
    receiptUrl: string | null;
  } | null;
  creditAllocations: AllocationDTO[];
}

interface BillingHistoryResponse {
  balance: number;
  entries: LedgerEntryDTO[];
  hasMore: boolean;
  nextCursor: string | null;
}

const useBillingHistory = (filters: {
  type: LedgerType;
  dateRange?: DateRange;
  cursor?: string | null;
}) => {
  return useQuery({
    queryKey: ["billing-history", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.type !== "all") params.set("type", filters.type);
      if (filters.dateRange?.from)
        params.set("from", filters.dateRange.from.toISOString());
      if (filters.dateRange?.to)
        params.set("to", filters.dateRange.to.toISOString());
      if (filters.cursor) params.set("cursor", filters.cursor);

      const { data } = await api.get<BillingHistoryResponse>(
        `/api/billing/history?${params.toString()}`
      );
      return data;
    },
  });
};

const useBalance = () => {
  return useQuery({
    queryKey: ["billing-balance"],
    queryFn: async () => {
      const { data } = await api.get<{ balance: number }>("/api/billing/balance");
      return data.balance;
    },
  });
};

function formatCredits(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`;
}

const LedgerRow: React.FC<{ entry: LedgerEntryDTO }> = ({ entry }) => {
  const isCredit = entry.type === "credit";
  const isDebit = entry.type === "debit";

  return (
    <div className="grid grid-cols-5 items-start gap-4 border-b border-border py-4 text-sm">
      <div className="space-y-1">
        <p className="font-medium">
          {isCredit ? "Credit" : isDebit ? "Debit" : "Adjustment"}
        </p>
        <p className="text-xs text-muted-foreground">
          {format(new Date(entry.createdAt), "PPpp")}
        </p>
      </div>
      <div>
        <p className={`font-semibold ${isCredit ? "text-emerald-600" : isDebit ? "text-rose-600" : ""}`}>
          {formatCredits(entry.credits)}
        </p>
        {entry.summaryId && (
          <p className="text-xs text-muted-foreground">Summary: {entry.summaryId}</p>
        )}
      </div>
      <div className="space-y-1">
        <p>{entry.description ?? (isCredit ? "Stripe purchase" : "Transcript summary")}</p>
        {entry.purchase?.stripePaymentIntentId && (
          <p className="text-xs text-muted-foreground">
            PI: {entry.purchase.stripePaymentIntentId}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {entry.creditAllocations.map((alloc) => (
          <Badge key={alloc.id} variant="secondary">
            {alloc.purchase?.stripePaymentIntentId ?? alloc.purchaseId}: {alloc.creditsUsed}
          </Badge>
        ))}
        {isCredit && entry.purchase?.receiptUrl && (
          <a
            href={entry.purchase.receiptUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary underline"
          >
            Receipt
          </a>
        )}
      </div>
      <div className="text-right text-xs text-muted-foreground">
        {entry.id}
      </div>
    </div>
  );
};

const FiltersBar: React.FC<{
  type: LedgerType;
  onTypeChange: (type: LedgerType) => void;
  dateRange?: DateRange;
  onDateRangeChange: (range: DateRange | undefined) => void;
  onResetCursor: () => void;
  loading: boolean;
}> = ({ type, onTypeChange, dateRange, onDateRangeChange, onResetCursor, loading }) => {
  const [open, setOpen] = useState(false);

  const label = useMemo(() => {
    if (!dateRange?.from) return "Date range";
    if (!dateRange.to) return format(dateRange.from, "PP");
    return `${format(dateRange.from, "PP")} - ${format(dateRange.to, "PP")}`;
  }, [dateRange]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <Tabs
        value={type}
        onValueChange={(value) => {
          onResetCursor();
          onTypeChange(value as LedgerType);
        }}
      >
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="credit">Credits</TabsTrigger>
          <TabsTrigger value="debit">Debits</TabsTrigger>
          <TabsTrigger value="adjustment">Adjustments</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn("justify-start text-left", !dateRange?.from && "text-muted-foreground")}
            >
              <Filter className="mr-2 h-4 w-4" /> {label}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={dateRange}
              onSelect={(range) => {
                onResetCursor();
                onDateRangeChange(range);
              }}
            />
          </PopoverContent>
        </Popover>
        <Button
          variant="ghost"
          onClick={() => {
            onResetCursor();
            onDateRangeChange(undefined);
          }}
        >
          Clear
        </Button>
        <ExportCsvButton type={type} dateRange={dateRange} disabled={loading} />
      </div>
    </div>
  );
};

const ExportCsvButton: React.FC<{ type: LedgerType; dateRange?: DateRange; disabled?: boolean }> = ({
  type,
  dateRange,
  disabled,
}) => {
  const [downloading, setDownloading] = useState(false);

  const handleExport = async () => {
    try {
      setDownloading(true);
      const params = new URLSearchParams();
      if (type !== "all") params.set("type", type);
      if (dateRange?.from) params.set("from", dateRange.from.toISOString());
      if (dateRange?.to) params.set("to", dateRange.to.toISOString());

      const response = await api.get(`/api/billing/history?${params.toString()}`, {
        headers: { Accept: "text/csv" },
        responseType: "blob",
      });

      const blob = new Blob([response.data], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "billing-history.csv");
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Button onClick={handleExport} disabled={disabled || downloading}>
      <Download className="mr-2 h-4 w-4" /> CSV
    </Button>
  );
};

const LedgerTableSkeleton = () => (
  <div className="space-y-4">
    {Array.from({ length: 5 }).map((_, idx) => (
      <div key={idx} className="grid grid-cols-5 gap-4 border-b border-border py-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-24 justify-self-end" />
      </div>
    ))}
  </div>
);

const AccountBillingPage: React.FC = () => {
  const [type, setType] = useState<LedgerType>("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [cursor, setCursor] = useState<string | null>(null);

  const historyQuery = useBillingHistory({ type, dateRange, cursor });
  const balanceQuery = useBalance();

  const handleNext = () => {
    if (historyQuery.data?.nextCursor) {
      setCursor(historyQuery.data.nextCursor);
    }
  };

  const handlePrev = () => {
    setCursor(null);
  };

  const entries = historyQuery.data?.entries ?? [];

  return (
    <AuthenticatedLayout>
      <div className="space-y-6 p-6 pt-16">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight">Billing History</h1>
          <Button variant="outline" onClick={() => historyQuery.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Balance</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div>
              <p className="text-4xl font-bold">
                {balanceQuery.isLoading ? <Skeleton className="h-10 w-32" /> : balanceQuery.data}
              </p>
              <p className="text-sm text-muted-foreground">Available credits</p>
            </div>
            <Button asChild>
              <a href="/checkout">Buy credits</a>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ledger</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <FiltersBar
              type={type}
              onTypeChange={setType}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              onResetCursor={() => setCursor(null)}
              loading={historyQuery.isFetching}
            />

            {historyQuery.isLoading ? (
              <LedgerTableSkeleton />
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 py-20 text-center text-muted-foreground">
                <p className="text-lg font-medium">No billing entries yet</p>
                <p className="text-sm">New credits and transcript debits will appear here immediately.</p>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-5 gap-4 border-b border-border pb-2 text-sm font-medium text-muted-foreground">
                  <div>Entry</div>
                  <div>Credits</div>
                  <div>Description</div>
                  <div>Allocations</div>
                  <div className="text-right">ID</div>
                </div>
                {entries.map((entry) => (
                  <LedgerRow key={entry.id} entry={entry} />
                ))}
              </div>
            )}

            <div className="flex items-center justify-between">
              <Button variant="ghost" disabled={!cursor} onClick={handlePrev}>
                Previous
              </Button>
              <span className="text-sm text-slate-600 dark:text-slate-400">
                Page {cursor ? 2 : 1}
              </span>
              <Button
                variant="ghost"
                onClick={handleNext}
                disabled={!historyQuery.data?.hasMore}
              >
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AuthenticatedLayout>
  );
};

export default AccountBillingPage;


