// src/components/admin/AdminPurchases.tsx

import React, { useState, useMemo } from "react";
import api from "@/lib/axios";
import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { User, ChevronUp, ChevronDown, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface Purchase {
  id: string;
  user: string;
  email: string;
  date: string; // ISO
  plan: string;
  amount: string; // e.g. "$49.99"
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

type SortKey = keyof Omit<Purchase, "id">;
type SortDir = "asc" | "desc";

export const AdminPurchases: React.FC = () => {
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
        email: p.user.email,
        date: p.createdAt,
        plan: `${p.creditsAdded} credits`,
        amount: `$${(p.amountCents / 100).toFixed(2)}`,
      }));
    },
    staleTime: 5 * 60_000,
  });

  // multi‐select filter state
  const [filterUsers, setFilterUsers] = useState<string[]>([]);
  const [filterMonths, setFilterMonths] = useState<string[]>([]);
  const [filterYears, setFilterYears] = useState<string[]>([]);
  const [filterPlans, setFilterPlans] = useState<string[]>([]);

  // sort state
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // compute unique options
  const uniqueUsers = useMemo(
    () => Array.from(new Set(purchases.map((p) => p.user))),
    [purchases]
  );
  const uniquePlans = useMemo(
    () => Array.from(new Set(purchases.map((p) => p.plan))),
    [purchases]
  );
  const uniqueMonths = useMemo(
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
  const uniqueYears = useMemo(
    () =>
      Array.from(
        new Set(purchases.map((p) => new Date(p.date).getFullYear().toString()))
      ),
    [purchases]
  );

  // filter + sort
  const displayed = useMemo(() => {
    let arr = [...purchases];
    if (filterUsers.length)
      arr = arr.filter((p) => filterUsers.includes(p.user));
    if (filterPlans.length)
      arr = arr.filter((p) => filterPlans.includes(p.plan));
    if (filterMonths.length)
      arr = arr.filter((p) =>
        filterMonths.includes(
          new Date(p.date).toLocaleString("default", { month: "long" })
        )
      );
    if (filterYears.length)
      arr = arr.filter((p) =>
        filterYears.includes(new Date(p.date).getFullYear().toString())
      );

    arr.sort((a, b) => {
      let av: any = a[sortKey],
        bv: any = b[sortKey];
      if (sortKey === "date") {
        av = new Date(a.date).getTime();
        bv = new Date(b.date).getTime();
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [
    purchases,
    filterUsers,
    filterPlans,
    filterMonths,
    filterYears,
    sortKey,
    sortDir,
  ]);

  if (isLoading) return <p>Loading purchase history…</p>;
  if (isError) return <p>Failed to load purchase history.</p>;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return null;
    return sortDir === "asc" ? (
      <ChevronUp className="inline-block ml-1 h-3 w-3" />
    ) : (
      <ChevronDown className="inline-block ml-1 h-3 w-3" />
    );
  };

  // CSV download
  const downloadCsv = () => {
    const header = ["User", "Email", "Date", "Plan", "Amount"];
    const rows = displayed.map((p) => [
      p.user,
      p.email,
      new Date(p.date).toLocaleDateString(),
      p.plan,
      p.amount,
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "purchase-history.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Purchase History</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={downloadCsv}
          className="flex items-center gap-1"
        >
          <Download className="h-4 w-4" /> Download CSV
        </Button>
      </div>

      {/* multi‑select filters */}
      <div className="flex flex-wrap gap-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Users ({filterUsers.length || "All"})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Filter by User</DropdownMenuLabel>
            {uniqueUsers.map((u) => (
              <DropdownMenuCheckboxItem
                key={u}
                checked={filterUsers.includes(u)}
                onCheckedChange={(checked) => {
                  setFilterUsers((prev) =>
                    checked ? [...prev, u] : prev.filter((x) => x !== u)
                  );
                }}
              >
                {u}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Months ({filterMonths.length || "All"})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Filter by Month</DropdownMenuLabel>
            {uniqueMonths.map((m) => (
              <DropdownMenuCheckboxItem
                key={m}
                checked={filterMonths.includes(m)}
                onCheckedChange={(checked) => {
                  setFilterMonths((prev) =>
                    checked ? [...prev, m] : prev.filter((x) => x !== m)
                  );
                }}
              >
                {m}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Years ({filterYears.length || "All"})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Filter by Year</DropdownMenuLabel>
            {uniqueYears.map((y) => (
              <DropdownMenuCheckboxItem
                key={y}
                checked={filterYears.includes(y)}
                onCheckedChange={(checked) => {
                  setFilterYears((prev) =>
                    checked ? [...prev, y] : prev.filter((x) => x !== y)
                  );
                }}
              >
                {y}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Plans ({filterPlans.length || "All"})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Filter by Plan</DropdownMenuLabel>
            {uniquePlans.map((p) => (
              <DropdownMenuCheckboxItem
                key={p}
                checked={filterPlans.includes(p)}
                onCheckedChange={(checked) => {
                  setFilterPlans((prev) =>
                    checked ? [...prev, p] : prev.filter((x) => x !== p)
                  );
                }}
              >
                {p}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead
              onClick={() => toggleSort("user")}
              className="cursor-pointer"
            >
              User
              <SortIcon column="user" />
            </TableHead>
            <TableHead
              onClick={() => toggleSort("email")}
              className="cursor-pointer"
            >
              Email
              <SortIcon column="email" />
            </TableHead>
            <TableHead
              onClick={() => toggleSort("date")}
              className="cursor-pointer"
            >
              Date
              <SortIcon column="date" />
            </TableHead>
            <TableHead
              onClick={() => toggleSort("plan")}
              className="cursor-pointer"
            >
              Plan
              <SortIcon column="plan" />
            </TableHead>
            <TableHead
              onClick={() => toggleSort("amount")}
              className="cursor-pointer text-right"
            >
              Amount
              <SortIcon column="amount" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayed.map((purchase) => (
            <TableRow key={purchase.id}>
              <TableCell className="font-medium">
                <div className="flex items-center">
                  <User className="mr-2 h-4 w-4 text-[#5674BC]" />
                  {purchase.user}
                </div>
              </TableCell>
              <TableCell>{purchase.email}</TableCell>
              <TableCell>
                {new Date(purchase.date).toLocaleDateString()}
              </TableCell>
              <TableCell>{purchase.plan}</TableCell>
              <TableCell className="text-right">{purchase.amount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
