import { useState, useEffect } from "react";
import api from "@/lib/axios";

export interface LedgerEntry {
  id: string;
  type: "credit" | "debit" | "adjustment";
  /** Presentation type: expirations/refunds are stored as "credit" rows but displayed distinctly. */
  displayType?: "credit" | "debit" | "adjustment" | "expired" | "refund";
  expired?: boolean;
  refund?: boolean;
  credits: number;
  description: string;
  summaryId?: string;
  createdAt: string;
  purchase?: {
    stripePaymentIntentId: string;
    amountCents: number;
    creditsAdded: number;
    status: string;
  };
  allocations?: Array<{
    id: string;
    purchaseId: string;
    creditsUsed: number;
    stripePaymentIntentId: string | null;
  }>;
}

interface BillingLedgerResponse {
  balance: number;
  entries: LedgerEntry[];
  nextCursor: string | null;
}

interface UseBillingLedgerOptions {
  type?: string;
  from?: string;
  to?: string;
  cursor?: string;
  refreshKey?: number;
}

export const useBillingLedger = (options: UseBillingLedgerOptions = {}) => {
  const [data, setData] = useState<BillingLedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchLedger = async () => {
      const { refreshKey, ...queryOptions } = options;
      try {
        setLoading(true);

        // Use the shared axios client so requests get the Bearer token and 401-refresh
        // behaviour automatically (previously this used raw fetch and missed token refresh).
        const params: Record<string, string> = {};
        if (queryOptions.type && queryOptions.type !== "all") params.type = queryOptions.type;
        if (queryOptions.from) params.from = queryOptions.from;
        if (queryOptions.to) params.to = queryOptions.to;
        if (queryOptions.cursor) params.cursor = queryOptions.cursor;

        const response = await api.get("/api/billing/history", { params });

        if (!cancelled) {
          setData(response.data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "An error occurred");
          setData(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchLedger();
    return () => {
      cancelled = true;
    };
  }, [options.type, options.from, options.to, options.cursor, options.refreshKey]);

  return { data, loading, error };
};
