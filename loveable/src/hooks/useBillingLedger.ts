import { useState, useEffect } from "react";

export interface LedgerEntry {
  id: string;
  type: "credit" | "debit" | "adjustment";
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
  creditAllocations?: Array<{
    creditsUsed: number;
    purchase?: {
      stripePaymentIntentId: string;
    };
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
        const token = localStorage.getItem("token");
        if (!token) {
          setError("No authentication token");
          return;
        }

        const params = new URLSearchParams();
        if (queryOptions.type && queryOptions.type !== "all") params.append("type", queryOptions.type);
        if (queryOptions.from) params.append("from", queryOptions.from);
        if (queryOptions.to) params.append("to", queryOptions.to);
        if (queryOptions.cursor) params.append("cursor", queryOptions.cursor);

        const queryString = params.toString();
        const baseUrl = import.meta.env.VITE_API_URL ?? "";
        const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, "") : "";
        const url = `${normalizedBase}/api/billing/history${queryString ? `?${queryString}` : ""}`;

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error("Failed to fetch billing history");
        }

        const result = await response.json();
        if (!cancelled) {
          setData(result);
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
