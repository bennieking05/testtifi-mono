// src/components/admin/PurchaseDashboard.tsx

import React, { useMemo, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axios"; // ✅ FIX: use custom Axios instance
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Loader2, AlertCircle } from "lucide-react";

interface Purchase {
  id: string;
  user: string;
  credits: number;
  amount: number;
  date: string; // ISO
  plan: string;
}

interface PurchaseResponse {
  id: string;
  user: { name: string | null; email: string };
  amountCents: number;
  currency: string;
  creditsAdded: number;
  status: string;
  createdAt: string;
}

interface DailyMetric {
  date: string; // YYYY-MM-DD
  count: number;
  revenue: number;
}

interface ExpiredCreditsSummary {
  totalExpired: number;
  topUsers: Array<{
    userId: string;
    name: string | null;
    email: string;
    creditsExpired: number;
    lastExpiredAt: string;
  }>;
  recent: Array<{
    id: string;
    userId: string;
    name: string | null;
    email: string;
    creditsExpired: number;
    expiredAt: string;
    purchaseId: string | null;
    purchaseDate: string | null;
    stripePaymentIntentId: string | null;
  }>;
}

export const PurchaseDashboard: React.FC = () => {
  const {
    data: purchases = [],
    isLoading,
    isError,
  } = useQuery<Purchase[], Error>({
    queryKey: ["purchaseHistory"],
    queryFn: async () => {
      const { data } = await api.get<PurchaseResponse[]>("/api/purchase/history");
      // Transform backend response to frontend format
      return data.map((p): Purchase => ({
        id: p.id,
        user: p.user.name || p.user.email,
        credits: p.creditsAdded,
        amount: p.amountCents / 100, // Convert cents to dollars
        date: p.createdAt,
        plan: `${p.creditsAdded} credits`,
      }));
    },
    staleTime: 5 * 60_000,
  });

  const {
    data: expiredSummary,
    isLoading: expiredLoading,
    isError: expiredError,
  } = useQuery<ExpiredCreditsSummary, Error>({
    queryKey: ["adminExpiredCredits"],
    queryFn: async () => {
      const { data } = await api.get<ExpiredCreditsSummary>("/api/admin/billing/expired");
      return data;
    },
    staleTime: 5 * 60_000,
  });

  const dashboardRef = useRef<HTMLDivElement>(null);

  const downloadPDF = async () => {
    if (!dashboardRef.current) return;
    const canvas = await html2canvas(dashboardRef.current, { scale: 2 });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "pt",
      format: [canvas.width, canvas.height],
    });
    pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
    pdf.save(`purchase-dashboard_${Date.now()}.pdf`);
  };

  const [filterUsers, setFilterUsers] = useState<string[]>([]);
  const [filterMonths, setFilterMonths] = useState<string[]>([]);
  const [filterYears, setFilterYears] = useState<string[]>([]);
  const [filterPlans, setFilterPlans] = useState<string[]>([]);

  const allUsers = useMemo(
    () => Array.from(new Set(purchases.map((p) => p.user))),
    [purchases]
  );
  const allPlans = useMemo(
    () => Array.from(new Set(purchases.map((p) => p.plan))),
    [purchases]
  );
  const allMonths = useMemo(
    () =>
      Array.from(
        new Set(
          purchases.map((p) =>
            new Date(p.date).toLocaleString("default", { month: "long" })
          )
        )
      ),
    [purchases]
  );
  const allYears = useMemo(
    () =>
      Array.from(
        new Set(purchases.map((p) => new Date(p.date).getFullYear().toString()))
      ),
    [purchases]
  );

  const filtered = useMemo(() => {
    return purchases.filter((p) => {
      const month = new Date(p.date).toLocaleString("default", {
        month: "long",
      });
      const year = new Date(p.date).getFullYear().toString();
      return (
        (filterUsers.length === 0 || filterUsers.includes(p.user)) &&
        (filterPlans.length === 0 || filterPlans.includes(p.plan)) &&
        (filterMonths.length === 0 || filterMonths.includes(month)) &&
        (filterYears.length === 0 || filterYears.includes(year))
      );
    });
  }, [purchases, filterUsers, filterPlans, filterMonths, filterYears]);

  const metrics = useMemo<DailyMetric[]>(() => {
    const map: Record<string, DailyMetric> = {};
    filtered.forEach((p) => {
      const day = p.date.slice(0, 10);
      if (!map[day]) map[day] = { date: day, count: 0, revenue: 0 };
      map[day].count++;
      map[day].revenue += p.amount;
    });
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered]);

  const totalCount = filtered.length;
  const totalRevenue = filtered.reduce((sum, p) => sum + p.amount, 0);
  const avgRevenue = totalCount ? totalRevenue / totalCount : 0;

  if (isLoading) return <p>Loading dashboard…</p>;
  if (isError) return <p>Failed to load purchases.</p>;

  return (
    <div className="space-y-6" ref={dashboardRef}>
      {/* Filters + CSV + PDF */}
      <div className="flex flex-wrap items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              Users ({filterUsers.length || "All"})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Filter by User</DropdownMenuLabel>
            {allUsers.map((u) => (
              <DropdownMenuCheckboxItem
                key={u}
                checked={filterUsers.includes(u)}
                onCheckedChange={(checked) =>
                  setFilterUsers((prev) =>
                    checked ? [...prev, u] : prev.filter((x) => x !== u)
                  )
                }
              >
                {u}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              Months ({filterMonths.length || "All"})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Filter by Month</DropdownMenuLabel>
            {allMonths.map((m) => (
              <DropdownMenuCheckboxItem
                key={m}
                checked={filterMonths.includes(m)}
                onCheckedChange={(checked) =>
                  setFilterMonths((prev) =>
                    checked ? [...prev, m] : prev.filter((x) => x !== m)
                  )
                }
              >
                {m}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              Years ({filterYears.length || "All"})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Filter by Year</DropdownMenuLabel>
            {allYears.map((y) => (
              <DropdownMenuCheckboxItem
                key={y}
                checked={filterYears.includes(y)}
                onCheckedChange={(checked) =>
                  setFilterYears((prev) =>
                    checked ? [...prev, y] : prev.filter((x) => x !== y)
                  )
                }
              >
                {y}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              Plans ({filterPlans.length || "All"})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Filter by Plan</DropdownMenuLabel>
            {allPlans.map((p) => (
              <DropdownMenuCheckboxItem
                key={p}
                checked={filterPlans.includes(p)}
                onCheckedChange={(checked) =>
                  setFilterPlans((prev) =>
                    checked ? [...prev, p] : prev.filter((x) => x !== p)
                  )
                }
              >
                {p}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const header = ["Date", "Count", "Revenue"];
            const rows = metrics.map((m) => [
              m.date,
              m.count,
              m.revenue.toFixed(2),
            ]);
            const csv = [header, ...rows]
              .map((r) => r.map((c) => `"${c}"`).join(","))
              .join("\n");
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `purchases_${Date.now()}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export CSV
        </Button>

        <Button size="sm" variant="outline" onClick={downloadPDF}>
          Export PDF
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Total Purchases</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Total Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalRevenue.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Average Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${avgRevenue.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Expired Credits</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {expiredLoading
                ? "…"
                : expiredSummary
                ? expiredSummary.totalExpired.toLocaleString()
                : "—"}
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Credits reclaimed after 3-day expiration window
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Purchases Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={metrics}>
                <defs>
                  <linearGradient id="gCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#5674BC" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#5674BC" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#5674BC"
                  fill="url(#gCount)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revenue Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={metrics}>
                <defs>
                  <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#82ca9d" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#82ca9d" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#82ca9d"
                  fill="url(#gRev)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Top Accounts by Expired Credits</CardTitle>
            <CardDescription>
              Tracks how many credits have expired per account in the last 500
              expiration events.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {expiredLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading expired credit data…</span>
              </div>
            ) : expiredError ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>Unable to load expired credit data.</span>
              </div>
            ) : expiredSummary && expiredSummary.topUsers.length ? (
              <ul className="space-y-3">
                {expiredSummary.topUsers.slice(0, 10).map((user) => (
                  <li
                    key={user.userId}
                    className="flex items-center justify-between rounded-lg border border-muted px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-semibold">
                        {user.name || user.email}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">
                        {user.creditsExpired.toLocaleString()} credits
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last expired{" "}
                        {new Date(user.lastExpiredAt).toLocaleDateString()}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No credits have expired yet.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Expired Credit Events</CardTitle>
            <CardDescription>
              Shows the 10 most recent expiration events across all accounts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {expiredLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading expired credit history…</span>
              </div>
            ) : expiredError ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>Unable to load expired credit history.</span>
              </div>
            ) : expiredSummary && expiredSummary.recent.length ? (
              <div className="space-y-3">
                {expiredSummary.recent.slice(0, 10).map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-muted bg-card px-3 py-3"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold">
                          {entry.name || entry.email}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {entry.email}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">
                          {entry.creditsExpired.toLocaleString()} credits
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(entry.expiredAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    {entry.stripePaymentIntentId && (
                      <div className="mt-2">
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() =>
                            window.open(
                              `https://dashboard.stripe.com/payments/${entry.stripePaymentIntentId}`,
                              "_blank",
                              "noopener,noreferrer"
                            )
                          }
                          className="p-0"
                        >
                          View Stripe payment
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No expired credit activity recorded.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
