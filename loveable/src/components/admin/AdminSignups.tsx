// src/components/admin/AdminSignups.tsx

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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { User, Download, ChevronUp, ChevronDown } from "lucide-react";

interface Signup {
  id: string;
  name: string;
  email: string;
  company: string;
  date: string; // ISO string
  status: "active" | "inactive";
}

type SortKey = keyof Omit<Signup, "id">;
type SortDir = "asc" | "desc";

export const AdminSignups: React.FC = () => {
  // --- fetch ---
  const {
    data: signups = [],
    isLoading,
    isError,
  } = useQuery<Signup[], Error>({
    queryKey: ["userSignups"],
    queryFn: async () => {
      const { data } = await api.get<Signup[]>("/api/user/signups");
      return data;
    },
    staleTime: 5 * 60_000,
  });

  // --- filters (multi‑select) ---
  const [filterNames, setFilterNames] = useState<string[]>([]);
  const [filterCompanies, setFilterCompanies] = useState<string[]>([]);
  const [filterMonths, setFilterMonths] = useState<string[]>([]);
  const [filterYears, setFilterYears] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);

  // --- sorting ---
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // --- derive unique options ---
  const uniqueNames = useMemo(
    () => Array.from(new Set(signups.map((s) => s.name))),
    [signups]
  );
  const uniqueCompanies = useMemo(
    () => Array.from(new Set(signups.map((s) => s.company))),
    [signups]
  );
  const uniqueMonths = useMemo(
    () =>
      Array.from(
        new Set(
          signups.map((s) =>
            new Date(s.date).toLocaleString("default", { month: "long" })
          )
        )
      ),
    [signups]
  );
  const uniqueYears = useMemo(
    () =>
      Array.from(
        new Set(signups.map((s) => new Date(s.date).getFullYear().toString()))
      ),
    [signups]
  );
  const uniqueStatuses = useMemo(
    () => Array.from(new Set(signups.map((s) => s.status))),
    [signups]
  );

  // --- filtered + sorted data ---
  const displayed = useMemo(() => {
    let arr = [...signups];

    if (filterNames.length) {
      arr = arr.filter((s) => filterNames.includes(s.name));
    }
    if (filterCompanies.length) {
      arr = arr.filter((s) => filterCompanies.includes(s.company));
    }
    if (filterMonths.length) {
      arr = arr.filter((s) =>
        filterMonths.includes(
          new Date(s.date).toLocaleString("default", { month: "long" })
        )
      );
    }
    if (filterYears.length) {
      arr = arr.filter((s) =>
        filterYears.includes(new Date(s.date).getFullYear().toString())
      );
    }
    if (filterStatuses.length) {
      arr = arr.filter((s) => filterStatuses.includes(s.status));
    }

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
    signups,
    filterNames,
    filterCompanies,
    filterMonths,
    filterYears,
    filterStatuses,
    sortKey,
    sortDir,
  ]);

  // --- sort toggler + icon ---
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortDir === "asc" ? (
      <ChevronUp className="inline-block ml-1 h-3 w-3" />
    ) : (
      <ChevronDown className="inline-block ml-1 h-3 w-3" />
    );
  };

  // --- CSV export ---
  const downloadCsv = () => {
    const header = ["Name", "Email", "Company", "Sign‑up Date", "Status"];
    const rows = displayed.map((s) => [
      s.name,
      s.email,
      s.company,
      new Date(s.date).toLocaleDateString(),
      s.status,
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "user_signups.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <p>Loading sign‑ups…</p>;
  if (isError) return <p>Failed to load sign‑ups.</p>;

  return (
    <div className="w-full space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">User Sign‑ups</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={downloadCsv}
          className="flex items-center gap-1"
        >
          <Download className="h-4 w-4" /> Download CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Names ({filterNames.length || "All"})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Filter by Name</DropdownMenuLabel>
            {uniqueNames.map((n) => (
              <DropdownMenuCheckboxItem
                key={n}
                checked={filterNames.includes(n)}
                onCheckedChange={(checked) =>
                  setFilterNames((prev) =>
                    checked ? [...prev, n] : prev.filter((x) => x !== n)
                  )
                }
              >
                {n}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Companies ({filterCompanies.length || "All"})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Filter by Company</DropdownMenuLabel>
            {uniqueCompanies.map((c) => (
              <DropdownMenuCheckboxItem
                key={c}
                checked={filterCompanies.includes(c)}
                onCheckedChange={(checked) =>
                  setFilterCompanies((prev) =>
                    checked ? [...prev, c] : prev.filter((x) => x !== c)
                  )
                }
              >
                {c}
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
            <Button variant="outline" size="sm">
              Status ({filterStatuses.length || "All"})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Filter by Status</DropdownMenuLabel>
            {uniqueStatuses.map((s) => (
              <DropdownMenuCheckboxItem
                key={s}
                checked={filterStatuses.includes(s)}
                onCheckedChange={(checked) =>
                  setFilterStatuses((prev) =>
                    checked ? [...prev, s] : prev.filter((x) => x !== s)
                  )
                }
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead
              onClick={() => toggleSort("name")}
              className="cursor-pointer"
            >
              User
              <SortIcon col="name" />
            </TableHead>
            <TableHead
              onClick={() => toggleSort("email")}
              className="cursor-pointer"
            >
              Email
              <SortIcon col="email" />
            </TableHead>
            <TableHead
              onClick={() => toggleSort("company")}
              className="cursor-pointer"
            >
              Company
              <SortIcon col="company" />
            </TableHead>
            <TableHead
              onClick={() => toggleSort("date")}
              className="cursor-pointer"
            >
              Sign‑up Date
              <SortIcon col="date" />
            </TableHead>
            <TableHead
              onClick={() => toggleSort("status")}
              className="cursor-pointer text-right"
            >
              Status
              <SortIcon col="status" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayed.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">
                <div className="flex items-center">
                  <User className="mr-2 h-4 w-4 text-[#5674BC]" />
                  {u.name}
                </div>
              </TableCell>
              <TableCell>{u.email}</TableCell>
              <TableCell>{u.company}</TableCell>
              <TableCell>{new Date(u.date).toLocaleDateString()}</TableCell>
              <TableCell className="text-right">
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                    u.status === "active"
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {u.status.charAt(0).toUpperCase() + u.status.slice(1)}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
