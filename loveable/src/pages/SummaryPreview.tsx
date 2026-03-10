import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download } from "lucide-react";
import api from "@/lib/axios";

// We render the backend-generated HTML preview in an iframe for fidelity

const SummaryPreview: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!id) return;
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get<string>(`/api/preview`, {
          params: { id },
          // Expect HTML string
          responseType: "text" as any,
        });
        if (mounted) setHtml(String(data));
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
  }, [id]);

  const handleDownload = () => {
    if (id) navigate(`/download/${id}`);
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
        <div className="text-white text-lg">Loading summary…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
        <div className="bg-white rounded-xl px-6 py-4 shadow-xl text-red-600 text-lg">
          {error}
        </div>
      </div>
    );
  }

  // Close handlers
  const close = () => {
    const fromSameOrigin = document.referrer && new URL(document.referrer).origin === window.location.origin;
    if (fromSameOrigin && window.history.length > 1) navigate(-1);
    else navigate("/summaries");
  };

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
      onClick={close}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-[96vw] h-[92vh] max-w-[1200px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <Button
            variant="ghost"
            onClick={close}
            className="text-gray-700 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button
            onClick={handleDownload}
            className="bg-[#5674BC] hover:bg-[#4a65a7] text-white"
          >
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
        </div>

        {/* Modal body */}
        <div className="flex-1 overflow-hidden">
          <iframe
            title="Preview"
            srcDoc={html}
            className="w-full h-full border-0"
          />
        </div>
      </div>
    </div>
  );
};

export default SummaryPreview;
