import React, { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  FileText,
  FileDown,
  Download,
  ArrowLeft,
  File,
  CheckCircle2,
  Shield,
  Sparkles,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthenticatedLayout } from "@/components/layout/AuthenticatedLayout";
import { DepositionFactLoader } from "@/components/ui/DepositionFactLoader";
import { toast } from "sonner";
import api from "@/lib/axios";

interface Summary {
  id: string;
  fileTitle: string;
  fileName: string;
  date: string;
  pages: number;
  totalPages?: number;
  lastPageProcessed?: number;
}

const DownloadSummary: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // Normalize incoming state so title.trim() is always safe
  const passed = (location.state as Partial<Summary>) || {};
  const [summaryData, setSummaryData] = useState<Summary>({
    id: passed.id || id || "",
    fileTitle: passed.fileTitle || "Untitled Document",
    fileName: passed.fileName || "",
    date: passed.date || "",
    pages: passed.pages || passed.totalPages || passed.lastPageProcessed || 0,
  });
  const [loading, setLoading] = useState(true);

  // Fetch actual summary data from API
  useEffect(() => {
    const fetchSummaryData = async () => {
      if (!id) {
        setLoading(false);
        return;
      }

      try {
        const response = await api.get<Summary[]>("/api/summaries");
        const summary = response.data.find((s) => s.id === id);
        
        if (summary) {
          setSummaryData({
            id: summary.id,
            fileTitle: summary.fileTitle || "Untitled Document",
            fileName: summary.fileName || "",
            date: summary.date || "",
            pages: summary.totalPages || summary.lastPageProcessed || summary.pages || 0,
          });
        }
      } catch (error) {
        console.error("Error fetching summary data:", error);
        // Keep the passed state if API call fails
      } finally {
        setLoading(false);
      }
    };

    fetchSummaryData();
  }, [id]);

  const [selectedFormat, setSelectedFormat] = useState<
    "pdf" | "docx" | "txt" | null
  >(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (!selectedFormat) {
      toast.error("Please select a format to download");
      return;
    }
    setIsDownloading(true);

    try {
      const response = await api.get(
        `/api/download?jobId=${summaryData.id}&format=${selectedFormat}`,
        { responseType: "blob" }
      );
      // Prefer server-provided filename from Content-Disposition
      const cd = (response.headers?.["content-disposition"] as string | undefined) || "";
      let filename = "";
      if (cd) {
        // RFC 5987 filename* takes precedence
        const starMatch = cd.match(/filename\*=UTF-8''([^;]+)/i);
        const stdMatch = cd.match(/filename="?([^";]+)"?/i);
        const raw = starMatch ? decodeURIComponent(starMatch[1]) : stdMatch ? stdMatch[1] : null;
        if (raw) filename = raw;
      }
      if (!filename) {
        const safeTitle = summaryData.title.replace(/\s+/g, "-").toLowerCase();
        filename = `${safeTitle}.${selectedFormat}`;
      }

      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

      toast.success(`Downloaded as ${selectedFormat.toUpperCase()}`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.response?.data?.error || "Download failed");
    } finally {
      setIsDownloading(false);
    }
  };

  // Format date safely
  const formatDate = (dateString: string) => {
    if (!dateString) return null;
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return null;
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return null;
    }
  };

  const formattedDate = formatDate(summaryData.date);

  const formatOptions = [
    {
      id: "pdf" as const,
      name: "PDF Document",
      icon: <FileText className="h-12 w-12 text-red-500 dark:text-red-400" />,
      description: "Best for printing and sharing",
      badge: "Professional",
    },
    {
      id: "docx" as const,
      name: "Word Document",
      icon: <FileDown className="h-12 w-12 text-blue-600 dark:text-blue-400" />,
      description: "Editable in Microsoft Word",
      badge: "Editable",
    },
    {
      id: "txt" as const,
      name: "Plain Text",
      icon: <File className="h-12 w-12 text-gray-600 dark:text-gray-400" />,
      description: "Simple text format",
      badge: "Universal",
    },
  ];

  if (loading) {
    return (
      <AuthenticatedLayout>
        <DepositionFactLoader message="Loading document details..." fullScreen={false} />
      </AuthenticatedLayout>
    );
  }

  return (
    <AuthenticatedLayout>
      <main className="flex-1 px-6 py-8 bg-slate-50 dark:bg-slate-900 min-h-screen">
        {/* Professional Header */}
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <Button
              variant="ghost"
              onClick={() => navigate(-1)}
              className="text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Summaries
            </Button>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Document ID: {summaryData.id.slice(-8).toUpperCase()}
            </div>
          </div>

          {/* Professional Title Section */}
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-8 mb-8">
            <div className="flex items-start gap-6">
              <div className="p-4 bg-slate-100 dark:bg-slate-700 rounded-lg">
                <FileText className="w-8 h-8 text-slate-600 dark:text-slate-300" />
              </div>
              <div className="flex-1">
                <h1 className="text-3xl font-serif font-bold text-slate-900 dark:text-slate-100 mb-2">
                  {summaryData.fileTitle}
                </h1>
                <p className="text-lg text-slate-600 dark:text-slate-400 mb-4">
                  Professional Legal Document Summary
                </p>
                <div className="flex items-center gap-6 text-sm text-slate-500 dark:text-slate-400">
                  {formattedDate && (
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>Created {formattedDate}</span>
                    </div>
                  )}
                  {summaryData.pages > 0 && (
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      <span>{summaryData.pages} pages processed</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    <span>Confidential & Encrypted</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Format Selection - Professional Layout */}
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-8">
            <div className="mb-8">
              <h2 className="text-2xl font-serif font-bold text-slate-900 dark:text-slate-100 mb-2">
                Export Document
              </h2>
              <p className="text-slate-600 dark:text-slate-400">
                Select your preferred format for professional distribution.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
              {formatOptions.map((format) => (
                <div
                  key={format.id}
                  onClick={() => setSelectedFormat(format.id)}
                  className={`relative border-2 rounded-lg p-6 cursor-pointer transition-all duration-200 ${
                    selectedFormat === format.id
                      ? "border-slate-900 dark:border-slate-300 bg-slate-50 dark:bg-slate-700 shadow-md"
                      : "border-slate-200 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500 bg-white dark:bg-slate-800"
                  }`}
                >
                  <div className="flex flex-col items-center text-center pr-10">
                    <div className="mb-4">{format.icon}</div>
                    <h3 className="font-semibold text-lg text-slate-900 dark:text-slate-100 mb-2">
                      {format.name}
                    </h3>
                    <p className="text-slate-600 dark:text-slate-400 text-sm mb-3">
                      {format.description}
                    </p>
                    <span className="inline-block px-3 py-1 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium rounded-full">
                      {format.badge}
                    </span>
                  </div>
                  
                  {selectedFormat === format.id && (
                    <div className="absolute top-3 right-3">
                      <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Professional Download Section */}
            <div className="border-t border-slate-200 dark:border-slate-600 pt-8">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                <div className="text-center sm:text-left">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
                    Ready to Download
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    The document will be saved to your downloads folder and is ready for immediate use.
                  </p>
                </div>
                
                <Button
                  onClick={handleDownload}
                  disabled={!selectedFormat || isDownloading}
                  className="px-8 py-3 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900 font-semibold rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 min-w-[180px]"
                  size="lg"
                >
                  {isDownloading ? (
                    <>
                      <div className="animate-spin w-4 h-4 border-2 border-white/30 dark:border-slate-900/30 border-t-white dark:border-t-slate-900 rounded-full mr-2" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-5 w-5" />
                      Download {selectedFormat ? selectedFormat.toUpperCase() : "Document"}
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Professional Footer */}
            <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-600">
              <div className="flex items-center justify-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  <span>Attorney-Client Privileged</span>
                </div>
                <div className="w-1 h-1 bg-slate-400 rounded-full" />
                <div className="flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Work Product Protected</span>
                </div>
                <div className="w-1 h-1 bg-slate-400 rounded-full" />
                <span>Confidential Document</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </AuthenticatedLayout>
  );
};

export default DownloadSummary;
