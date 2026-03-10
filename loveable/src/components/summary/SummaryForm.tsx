
// ─── src/components/summary/SummaryForm.tsx ──────────────────────────────────
import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import FileUploader from "@/components/dashboard/FileUploader";
import { EmailNotificationDialog } from "@/components/dialogs/EmailNotificationDialog";

interface SummaryFormProps {
  file?: File | null;
}

const SummaryForm: React.FC<SummaryFormProps> = ({
  file: initialFile = null,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const routerFile = (location.state as { file?: File })?.file;

  const [file, setFile] = useState<File | null>(routerFile || initialFile);
  const [summaryName, setSummaryName] = useState("");
  const [deponent, setDeponent] = useState("");
  const [uploadMsg, setUploadMsg] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);

  /* e-mail dialog */
  const [showDialog, setShowDialog] = useState(false);
  const [recentId, setRecentId] = useState<string>("");
  const [dialogClosed, setDialogClosed] = useState(false);

  /* auto-fill */
  useEffect(() => {
    const f = routerFile || initialFile;
    if (f) {
      setFile(f);
      setSummaryName((prev) => prev || f.name);
    }
  }, [routerFile, initialFile]);

  const handleFileSelect = (f: File) => {
    setFile(f);
    setSummaryName((prev) => prev || f.name);
  };

  /* ───────── upload (two-step: signed URL → direct GCS upload → complete) ───── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setUploadMsg("Please select a file.");
      return;
    }

    setIsUploading(true);
    setUploadMsg("Preparing upload…");

    const apiBase = import.meta.env.VITE_API_URL || "";
    const authHeader = { Authorization: `Bearer ${localStorage.getItem("token")}` };

    try {
      /* ── Step 1: reserve credit & get a GCS signed URL ── */
      const initRes = await fetch(`${apiBase}/api/upload/init`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          summaryName,
          deponent,
        }),
      });

      if (!initRes.ok) {
        const { error = "" } = await initRes.json().catch(() => ({}));
        if (initRes.status === 402 || /not enough credits/i.test(error)) {
          navigate("/payment", {
            state: {
              returnTo: "/create-summary",
              reason: error || "Please purchase more summary tokens.",
            },
          });
          return;
        }
        throw new Error(error || "Failed to prepare upload");
      }

      const { reservationId, objectKey, signedUrl, fileName: safeName } = await initRes.json();

      /* ── Step 2: upload the file directly to GCS (bypasses Cloud Run) ── */
      setUploadMsg("Uploading file…");
      const gcsRes = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });

      if (!gcsRes.ok) {
        throw new Error("File upload failed. Please try again.");
      }

      /* ── Step 3: tell the backend the upload is done ── */
      setUploadMsg("Finalizing…");
      const completeRes = await fetch(`${apiBase}/api/upload/complete`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          reservationId,
          objectKey,
          fileName: safeName,
          summaryName,
          deponent,
          notifyOnComplete: false,
        }),
      });

      if (!completeRes.ok) {
        const { error = "" } = await completeRes.json().catch(() => ({}));
        throw new Error(error || "Failed to finalize upload");
      }

      const { jobId } = await completeRes.json();
      setRecentId(jobId);
      // Immediately go to processing tab on Summaries
      navigate("/summaries", {
        state: { recentSummaryId: jobId, tab: "processing", promptEmail: true, summaryName },
      });
    } catch (err: any) {
      setUploadMsg(err.message || "There was an error uploading your file.");
    } finally {
      setIsUploading(false);
    }
  };

  /* navigate once the dialog is closed */
  // No longer needed as we navigate immediately after upload success.
  // Keeping state hooks above for minimal footprint compatibility.

  /* ───────── UI ───────── */
  return (
    <>
      <form className="w-full" onSubmit={handleSubmit}>
        {/* Summary Name */}
        <div className="mt-11 max-md:mt-10">
          <label
            htmlFor="summaryName"
            className="flex gap-2 text-lg font-semibold"
          >
            <span className="text-black dark:text-white">Summary Name</span>
            <span className="self-start text-black dark:text-white">*</span>
          </label>
          <input
            id="summaryName"
            className="w-full mt-5 rounded-xl border bg-white dark:bg-slate-800 border-slate-500 dark:border-slate-600 h-[55px] px-4 text-black dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#5674BC] dark:focus:ring-blue-500"
            required
            disabled={isUploading}
            value={summaryName}
            onChange={(e) => setSummaryName(e.target.value)}
          />
        </div>

        {/* Deponent */}
        <div className="mt-9">
          <label
            htmlFor="deponent"
            className="flex gap-2 text-lg font-semibold"
          >
            <span className="text-black dark:text-white">Deponent</span>
            <span className="self-start text-black dark:text-white">*</span>
          </label>
          <input
            id="deponent"
            className="w-full mt-5 rounded-xl border bg-white dark:bg-slate-800 border-slate-500 dark:border-slate-600 h-[55px] px-4 text-black dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#5674BC] dark:focus:ring-blue-500"
            required
            disabled={isUploading}
            value={deponent}
            onChange={(e) => setDeponent(e.target.value)}
          />
        </div>

        {/* Document picker */}
        <div className="mt-8">
          <label className="flex gap-2 text-lg font-semibold">
            <span className="text-black dark:text-white">Selected Document</span>
            <span className="self-start text-black dark:text-white">*</span>
          </label>
          <FileUploader
            onFileUpload={handleFileSelect}
            initialFile={file || undefined}
            disabled={isUploading}
          />
        </div>

        <button
          type="submit"
          className={`w-full mt-8 px-16 pt-4 pb-6 text-lg font-bold text-white bg-[#5674BC] hover:bg-[#4a65a7] dark:bg-blue-600 dark:hover:bg-blue-700 rounded-xl transition-colors ${
            isUploading ? "opacity-60 cursor-not-allowed" : ""
          }`}
          disabled={isUploading}
        >
          {isUploading ? "Uploading…" : "Continue"}
        </button>

        {uploadMsg && (
          <p className="mt-4 text-center text-sm text-gray-600 dark:text-gray-300">{uploadMsg}</p>
        )}
      </form>

      {/* EmailNotificationDialog moved to Summaries page (opens on arrival) */}
    </>
  );
};

export default SummaryForm;
