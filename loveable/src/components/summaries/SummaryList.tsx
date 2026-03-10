// ─── src/components/summaries/SummaryList.tsx ────────────────────────────────
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { FileText, Download, Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PreviewModal } from "@/components/summaries/PreviewModal";

export interface Summary {
  id: string;
  fileTitle: string;
  fileName: string;
  date: string;
  pages: number;
  totalPages?: number;
  lastPageProcessed?: number;
  timeMinutes?: number;
  summaryUrl?: string;
  status: "active" | "inactive" | "processing" | "error";
}

export interface SummaryListProps {
  activeTab?: "active" | "inactive" | "processing";
  highlightId?: string;
  summaries: {
    active: Summary[];
    inactive: Summary[];
    processing: Summary[];
  };
}

const SummaryList: React.FC<SummaryListProps> = ({
  activeTab = "active",
  highlightId,
  summaries,
}) => {
  const navigate = useNavigate();
  const highlightTableRef = useRef<HTMLTableRowElement | null>(null);
  const highlightCardRef = useRef<HTMLDivElement | null>(null);
  const [selectedTab, setSelectedTab] = useState<
    "active" | "inactive" | "processing"
  >(activeTab);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    if (highlightId) {
      const element = highlightTableRef.current || highlightCardRef.current;
      element?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [highlightId]);

  const handlePreview = (s: Summary) => {
    setPreviewId(s.id);
    setPreviewOpen(true);
  };

  const handleDownload = (s: Summary) =>
    navigate(`/download/${s.id}`, { state: s });

  const badgeClass = (st: Summary["status"]) =>
    st === "active"
      ? "bg-green-100 text-green-800"
      : st === "processing"
      ? "bg-yellow-100 text-yellow-800"
      : st === "error"
      ? "bg-red-100 text-red-700"
      : "bg-gray-100 text-gray-800";

  const renderRow = (s: Summary, showActions: boolean) => {
    const isProcessing = s.status === "processing";
    const displayStatus =
      selectedTab === "inactive"
        ? "inactive"
        : s.status === "error"
        ? "error"
        : s.status;

    // format time to one decimal place, e.g. "3.5 mins"
    const formattedTime =
      s.timeMinutes != null
        ? `${parseFloat(s.timeMinutes.toFixed(1))} mins`
        : "-";

    // if totalPages is zero or undefined, fall back to lastPageProcessed
    const displayTotalPages =
      s.totalPages && s.totalPages > 0
        ? s.totalPages
        : s.lastPageProcessed ?? "-";

    return (
      <TableRow
        key={s.id}
        ref={s.id === highlightId ? highlightTableRef : undefined}
        className={`${
          s.id === highlightId ? "bg-yellow-50 dark:bg-yellow-900/20" : ""
        } hover:bg-gray-50/50 dark:hover:bg-slate-700/50 transition-colors`}
      >
        <TableCell className="font-medium">
          <div className="flex items-center min-w-0">
            <FileText className="mr-2 h-4 w-4 text-[#5674BC] flex-shrink-0" />
            <span className="truncate text-sm lg:text-base">{s.fileTitle || s.fileName}</span>
          </div>
        </TableCell>

        <TableCell className="hidden sm:table-cell text-sm">
          {new Date(s.date).toLocaleDateString()}
        </TableCell>

        <TableCell className="hidden lg:table-cell">
          {displayTotalPages}
        </TableCell>

        <TableCell className="hidden lg:table-cell">
          {s.lastPageProcessed ?? "-"}
        </TableCell>

        <TableCell className="hidden lg:table-cell">{formattedTime}</TableCell>

        <TableCell>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeClass(
              displayStatus as Summary["status"]
            )}`}
          >
            {displayStatus[0].toUpperCase() + displayStatus.slice(1)}
            {isProcessing && <Loader2 className="ml-1 h-3 w-3 animate-spin" />}
          </span>
        </TableCell>

        {showActions && (
          <TableCell className="text-right">
            <div className="flex justify-end gap-1 lg:gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isProcessing}
                className={`text-xs px-2 lg:px-3 ${
                  isProcessing ? "opacity-50 cursor-not-allowed" : ""
                }`}
                onClick={() => handlePreview(s)}
              >
                <Eye className="h-3 w-3 lg:mr-1" />
                <span className="hidden lg:inline">Preview</span>
              </Button>
              <Button
                size="sm"
                disabled={isProcessing}
                className={`bg-[#5674BC] hover:bg-[#4a65a7] text-xs px-2 lg:px-3 ${
                  isProcessing ? "opacity-50 cursor-not-allowed" : ""
                }`}
                onClick={() => handleDownload(s)}
              >
                <Download className="h-3 w-3 lg:mr-1" />
                <span className="hidden lg:inline">Download</span>
              </Button>
            </div>
          </TableCell>
        )}
      </TableRow>
    );
  };

  const renderCard = (s: Summary, showActions: boolean) => {
    const isProcessing = s.status === "processing";
    const displayStatus =
      selectedTab === "inactive"
        ? "inactive"
        : s.status === "error"
        ? "error"
        : s.status;

    const formattedTime =
      s.timeMinutes != null
        ? `${parseFloat(s.timeMinutes.toFixed(1))} mins`
        : "-";

    const displayTotalPages =
      s.totalPages && s.totalPages > 0
        ? s.totalPages
        : s.lastPageProcessed ?? "-";

    return (
      <div
        key={s.id}
        ref={s.id === highlightId ? highlightCardRef : undefined}
        className={`p-3 sm:p-4 bg-white dark:bg-slate-800 rounded-lg border ${
          s.id === highlightId
            ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20"
            : "border-gray-200 dark:border-slate-700"
        } hover:shadow-md transition-all`}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <FileText className="h-4 w-4 text-[#5674BC] flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-sm sm:text-base text-slate-900 dark:text-slate-100 truncate">
                {s.fileTitle || s.fileName}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {new Date(s.date).toLocaleDateString()}
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium flex-shrink-0 ${badgeClass(
              displayStatus as Summary["status"]
            )}`}
          >
            {displayStatus[0].toUpperCase() + displayStatus.slice(1)}
            {isProcessing && <Loader2 className="ml-1 h-3 w-3 animate-spin" />}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-3 text-xs sm:text-sm">
          <div>
            <span className="text-slate-500 dark:text-slate-400">Total Pages:</span>
            <span className="ml-1 font-medium text-slate-700 dark:text-slate-300">
              {displayTotalPages}
            </span>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">Last Page:</span>
            <span className="ml-1 font-medium text-slate-700 dark:text-slate-300">
              {s.lastPageProcessed ?? "-"}
            </span>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">Time:</span>
            <span className="ml-1 font-medium text-slate-700 dark:text-slate-300">
              {formattedTime}
            </span>
          </div>
        </div>

        {showActions && (
          <div className="flex gap-2 pt-3 border-t border-gray-200 dark:border-slate-700">
            <Button
              variant="outline"
              size="sm"
              disabled={isProcessing}
              className={`flex-1 text-xs ${
                isProcessing ? "opacity-50 cursor-not-allowed" : ""
              }`}
              onClick={() => handlePreview(s)}
            >
              <Eye className="h-3 w-3 mr-1" />
              Preview
            </Button>
            <Button
              size="sm"
              disabled={isProcessing}
              className={`flex-1 bg-[#5674BC] hover:bg-[#4a65a7] text-xs ${
                isProcessing ? "opacity-50 cursor-not-allowed" : ""
              }`}
              onClick={() => handleDownload(s)}
            >
              <Download className="h-3 w-3 mr-1" />
              Download
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full mt-2 sm:mt-4 lg:mt-8">
      <Tabs
        value={selectedTab}
        onValueChange={(val) => setSelectedTab(val as any)}
        className="w-full"
      >
        <TabsList className="mb-3 sm:mb-4 lg:mb-6 grid w-full grid-cols-3 h-auto">
          <TabsTrigger value="active" className="text-xs sm:text-sm py-2 sm:py-2.5">
            Active
          </TabsTrigger>
          <TabsTrigger value="inactive" className="text-xs sm:text-sm py-2 sm:py-2.5">
            Inactive
          </TabsTrigger>
          <TabsTrigger value="processing" className="text-xs sm:text-sm py-2 sm:py-2.5">
            Processing
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          {summaries.active.length ? (
            <>
              {/* Mobile Card Layout */}
              <div className="md:hidden space-y-3">
                {summaries.active.map((s) => renderCard(s, true))}
              </div>
              {/* Desktop Table Layout */}
              <div className="hidden md:block overflow-x-auto border-2 border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead className="hidden sm:table-cell">Date</TableHead>
                      <TableHead className="hidden lg:table-cell">
                        Total Pages
                      </TableHead>
                      <TableHead className="hidden lg:table-cell">
                        Last Page
                      </TableHead>
                      <TableHead className="hidden lg:table-cell">
                        Time (mins)
                      </TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summaries.active.map((s) => renderRow(s, true))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <p className="text-center py-8 text-gray-600 dark:text-slate-400">
              No active summaries available.
            </p>
          )}
        </TabsContent>

        <TabsContent value="inactive">
          {summaries.inactive.length ? (
            <>
              {/* Mobile Card Layout */}
              <div className="md:hidden space-y-3">
                {summaries.inactive.map((s) => renderCard(s, false))}
              </div>
              {/* Desktop Table Layout */}
              <div className="hidden md:block overflow-x-auto border-2 border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead className="hidden sm:table-cell">Date</TableHead>
                      <TableHead className="hidden lg:table-cell">
                        Total Pages
                      </TableHead>
                      <TableHead className="hidden lg:table-cell">
                        Last Page
                      </TableHead>
                      <TableHead className="hidden lg:table-cell">
                        Time (mins)
                      </TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summaries.inactive.map((s) => renderRow(s, false))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <p className="text-center py-8 text-gray-600 dark:text-slate-400">
              No inactive summaries available.
            </p>
          )}
        </TabsContent>

        <TabsContent value="processing">
          {summaries.processing.length ? (
            <>
              {/* Mobile Card Layout */}
              <div className="md:hidden space-y-3">
                {summaries.processing.map((s) => renderCard(s, false))}
              </div>
              {/* Desktop Table Layout */}
              <div className="hidden md:block overflow-x-auto border-2 border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead className="hidden sm:table-cell">Date</TableHead>
                      <TableHead className="hidden lg:table-cell">
                        Total Pages
                      </TableHead>
                      <TableHead className="hidden lg:table-cell">
                        Last Page
                      </TableHead>
                      <TableHead className="hidden lg:table-cell">
                        Time (mins)
                      </TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summaries.processing.map((s) => renderRow(s, false))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <p className="text-center py-8 text-gray-600 dark:text-slate-400">
              No processing summaries available.
            </p>
          )}
        </TabsContent>
      </Tabs>
      <PreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        jobId={previewId}
        onDownload={(id) => navigate(`/download/${id}`)}
      />
    </div>
  );
};

export default SummaryList;
