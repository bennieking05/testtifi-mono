// src/components/admin/AdminSupport.tsx

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare,
  Eye,
  Reply as ReplyIcon,
  CheckCircle2,
  MoveRight,
  X,
} from "lucide-react";

import api from "@/lib/axios"; // ✅ FIXED: Use custom axios instance

import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

/* -------------------------------------------------------------------------- */
/*                                    types                                   */
/* -------------------------------------------------------------------------- */

type ApiStatus = "OPEN" | "IN_PROGRESS" | "CLOSED";
export type UIStatus = "open" | "in_progress" | "closed";

interface SupportResponse {
  from: "support" | "user";
  date: string;
  message: string;
}

export interface SupportTicket {
  id: string;
  name?: string;
  email: string;
  subject: string;
  createdAt: string;
  status: UIStatus;
  source: "Support Request";
  message: string;
  responses: SupportResponse[];
}

/* -------------------------------------------------------------------------- */
/*                               helpers                                      */
/* -------------------------------------------------------------------------- */

const normalize = (raw: any): SupportTicket => {
  const rs = String(raw.status).toUpperCase() as ApiStatus;
  let uiStatus: UIStatus;
  switch (rs) {
    case "OPEN":
      uiStatus = "open";
      break;
    case "IN_PROGRESS":
      uiStatus = "in_progress";
      break;
    case "CLOSED":
      uiStatus = "closed";
      break;
    default:
      uiStatus = "open";
  }
  return {
    id: raw.id,
    name: raw.user ?? undefined,
    email: raw.email,
    subject: raw.subject,
    createdAt: raw.createdAt,
    status: uiStatus,
    source: "Support Request",
    message: raw.message,
    responses: Array.isArray(raw.responses) ? raw.responses : [],
  };
};

const badgeColor = (s: UIStatus) =>
  s === "open"
    ? "bg-red-100 text-red-800"
    : s === "in_progress"
    ? "bg-yellow-100 text-yellow-800"
    : "bg-green-100 text-green-800";

/* -------------------------------------------------------------------------- */
/*                                  page                                      */
/* -------------------------------------------------------------------------- */

export const AdminSupport: React.FC = () => {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [replyText, setReplyText] = useState("");

  const {
    data: tickets = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["supportTickets"],
    queryFn: async () => {
      const { data } = await api.get("/api/support");
      return (data as any[]).map(normalize);
    },
    staleTime: 5 * 60_000,
  });

  const sendReply = useMutation<any, Error, { id: string; message: string }>({
    mutationFn: ({ id, message }) =>
      api.post(`/api/support/${id}/reply`, { message }),
    onSuccess: () => {
      toast.success("Reply sent");
      setReplyText("");
      qc.invalidateQueries({ queryKey: ["supportTickets"] });
    },
    onError: () => toast.error("Failed to send reply"),
  });

  const updateStatus = useMutation<
    any,
    Error,
    { id: string; status: ApiStatus }
  >({
    mutationFn: ({ id, status }) => api.patch(`/api/support/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["supportTickets"] }),
    onError: () => toast.error("Failed to update status"),
  });

  const filterTickets = (tab: string) => {
    switch (tab) {
      case "open":
        return tickets.filter((t) => t.status === "open");
      case "in_progress":
        return tickets.filter((t) => t.status === "in_progress");
      case "closed":
        return tickets.filter((t) => t.status === "closed");
      default:
        return tickets;
    }
  };

  if (isLoading) return <p>Loading support requests…</p>;
  if (isError) {
    console.error(error);
    return <p>Unable to load support requests.</p>;
  }

  return (
    <div className="w-full">
      <h2 className="text-xl font-semibold mb-4">Support Requests</h2>
      <Tabs defaultValue="all" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="in_progress">In Progress</TabsTrigger>
          <TabsTrigger value="closed">Closed</TabsTrigger>
        </TabsList>

        {["all", "open", "in_progress", "closed"].map((tab) => (
          <TabsContent key={tab} value={tab}>
            <SupportTable tickets={filterTickets(tab)} onView={setSelected} />
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        {selected && (
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-red-600" />
                {selected.subject}
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{selected.name ?? "Guest"}</span>
                <span className="text-gray-500">&lt;{selected.email}&gt;</span>·
                <span className="text-gray-500">
                  {new Date(selected.createdAt).toLocaleString()}
                </span>
                ·
                <Badge className={badgeColor(selected.status)}>
                  {selected.status.replace("_", " ")}
                </Badge>
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="flex-1 pr-4 -mr-4 space-y-4">
              <div className="border rounded-lg p-4 bg-gray-50">
                <p className="whitespace-pre-wrap text-sm">
                  {selected.message}
                </p>
              </div>

              {selected.responses.map((r, i) => (
                <div
                  key={i}
                  className={`border rounded-lg p-4 ${
                    r.from === "support"
                      ? "bg-red-50 border-red-100"
                      : "bg-gray-50"
                  }`}
                >
                  <div className="flex justify-between mb-2">
                    <span className="text-xs font-medium">
                      {r.from === "support" ? "Support" : selected.name}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(r.date).toLocaleString()}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{r.message}</p>
                </div>
              ))}
            </ScrollArea>

            {selected.status !== "closed" && (
              <div className="space-y-2">
                {selected.status === "open" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      updateStatus.mutate({
                        id: selected.id,
                        status: "IN_PROGRESS",
                      })
                    }
                    disabled={updateStatus.status === "pending"}
                    className="mb-2"
                  >
                    <MoveRight className="mr-1 h-4 w-4" />
                    Mark In Progress
                  </Button>
                )}

                <Textarea
                  rows={4}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write a reply…"
                />

                <div className="flex justify-between">
                  <Button
                    size="sm"
                    onClick={() =>
                      sendReply.mutate({
                        id: selected.id,
                        message: replyText.trim(),
                      })
                    }
                    disabled={
                      !replyText.trim() || sendReply.status === "pending"
                    }
                  >
                    <ReplyIcon className="mr-1 h-4 w-4" />
                    Send Reply
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 hover:text-red-700"
                    onClick={() =>
                      updateStatus.mutate({
                        id: selected.id,
                        status: "CLOSED",
                      })
                    }
                    disabled={updateStatus.status === "pending"}
                  >
                    <X className="mr-1 h-4 w-4" />
                    Mark Closed
                  </Button>
                </div>
              </div>
            )}

            {selected.status === "closed" && (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                Ticket closed
              </div>
            )}

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Close</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*                               table component                              */
/* -------------------------------------------------------------------------- */

interface SupportTableProps {
  tickets: SupportTicket[];
  onView: (t: SupportTicket) => void;
}

const SupportTable: React.FC<SupportTableProps> = ({ tickets, onView }) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>User</TableHead>
        <TableHead>Subject</TableHead>
        <TableHead>Date</TableHead>
        <TableHead>Status</TableHead>
        <TableHead className="text-right">Actions</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {tickets.length === 0 ? (
        <TableRow>
          <TableCell colSpan={5} className="text-center py-6">
            No support requests found
          </TableCell>
        </TableRow>
      ) : (
        tickets.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="font-medium">{t.name ?? "Guest"}</TableCell>
            <TableCell className="max-w-[240px] truncate">
              <div className="flex items-center">
                <MessageSquare className="mr-2 h-4 w-4 text-red-600" />
                {t.subject}
              </div>
            </TableCell>
            <TableCell>{new Date(t.createdAt).toLocaleDateString()}</TableCell>
            <TableCell>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeColor(
                  t.status
                )}`}
              >
                {t.status.replace("_", " ")}
              </span>
            </TableCell>
            <TableCell className="text-right">
              <Button variant="outline" size="sm" onClick={() => onView(t)}>
                <Eye className="mr-1 h-4 w-4" />
                View
              </Button>
            </TableCell>
          </TableRow>
        ))
      )}
    </TableBody>
  </Table>
);
