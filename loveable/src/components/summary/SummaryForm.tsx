
// ─── src/components/summary/SummaryForm.tsx ──────────────────────────────────
import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import FileUploader from "@/components/dashboard/FileUploader";
import { EmailNotificationDialog } from "@/components/dialogs/EmailNotificationDialog";
import api from "@/lib/axios";

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

    try {
      /* ── Step 1: reserve credit & get a GCS signed URL ──
         Backend calls go through the shared axios client (Bearer + 401-refresh). */
      let initData: {
        reservationId: string;
        objectKey: string;
        signedUrl: string;
        fileName: string;
      };
      try {
        const initRes = await api.post("/api/upload/init", {
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          summaryName,
          deponent,
        });
        initData = initRes.data;
      } catch (err: any) {
        const status = err?.response?.status;
        const error: string = err?.response?.data?.error || "";
        if (status === 402 || /not enough credits/i.test(error)) {
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

      const { reservationId, objectKey, signedUrl, fileName: safeName } = initData;

      /* ── Step 2: upload the file directly to GCS (bypasses Cloud Run) ──
         IMPORTANT: this is a signed URL on storage.googleapis.com — it must use raw fetch,
         NOT the api client (no Authorization header, different host). */
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
      let jobId: string;
      try {
        const completeRes = await api.post("/api/upload/complete", {
          reservationId,
          objectKey,
          fileName: safeName,
          summaryName,
          deponent,
          notifyOnComplete: false,
        });
        jobId = completeRes.data.jobId;
      } catch (err: any) {
        throw new Error(err?.response?.data?.error || "Failed to finalize upload");
      }

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
            onFileRemoved={() => setFile(null)}
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
