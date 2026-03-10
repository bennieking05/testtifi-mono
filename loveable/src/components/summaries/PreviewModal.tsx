import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download } from "lucide-react";
import api from "@/lib/axios";

interface PreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string | null;
  onDownload?: (jobId: string) => void;
}

export const PreviewModal: React.FC<PreviewModalProps> = ({
  open,
  onOpenChange,
  jobId,
  onDownload,
}) => {
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!open || !jobId) return;
      setHtml("");
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get<string>("/api/preview", {
          params: { id: jobId },
          responseType: "text" as any,
        });
        if (mounted) setHtml(typeof data === "string" ? data : String(data));
      } catch (e: any) {
        if (mounted)
          setError(e?.response?.data?.error || "Failed to load preview.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [open, jobId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // lock scroll when modal is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] bg-black/60 flex items-center justify-center p-4"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full h-full max-w-[1200px] max-h-[calc(100vh-2rem)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-gray-700 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button
            onClick={() => jobId && onDownload?.(jobId)}
            className="bg-[#5674BC] hover:bg-[#4a65a7] text-white"
          >
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
        </div>

        <div className="flex-1 overflow-hidden rounded-b-2xl">
          {loading ? (
            <div className="w-full h-full flex items-center justify-center text-gray-700">
              Loading summary…
            </div>
          ) : error ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="bg-white rounded-xl px-6 py-4 shadow-xl text-red-600 text-lg">
                {error}
              </div>
            </div>
          ) : html.trim().length === 0 ? (
            <div className="w-full h-full flex items-center justify-center flex-col gap-3 text-gray-700">
              <div>Preview is empty. Try opening in a new tab.</div>
              <Button
                onClick={() => jobId && window.open(`/preview/${jobId}`, "_blank", "noopener")}
                className="bg-[#5674BC] hover:bg-[#4a65a7] text-white"
              >
                Open Full Preview
              </Button>
            </div>
          ) : (
            <div 
              className="w-full h-full overflow-auto p-4"
              dangerouslySetInnerHTML={{
                __html: html
                  .replace(/<table>/g, '<table class="border-collapse border border-gray-300 w-full">')
                  .replace(/<th>/g, '<th class="border border-gray-300 bg-gray-100 px-3 py-2 font-semibold">')
                  .replace(/<td>/g, '<td class="border border-gray-300 px-3 py-2">')
              }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
