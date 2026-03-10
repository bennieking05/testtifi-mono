// ─── src/pages/CreateSummary.tsx ─────────────────────────────────────────────
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AuthenticatedLayout } from "@/components/layout/AuthenticatedLayout";
import SummaryForm from "@/components/summary/SummaryForm";
import { FileText, Sparkles, Shield, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const CreateSummary = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const file = (location.state as any)?.file || null;

  return (
    <AuthenticatedLayout>
      {/* ───────── page header ───────── */}
      <header className="w-full bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm px-6 py-6 shadow-sm border-b border-gray-200 dark:border-slate-700 mt-16 lg:mt-0">
        <div className="flex items-center gap-4 mb-4">
          <Button
            variant="ghost"
            onClick={() => navigate("/dashboard")}
            className="text-[#5674BC] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>

        <div className="flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-[#5674BC] to-[#4a65a7] rounded-xl shadow-lg">
            <FileText className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 dark:from-slate-200 dark:to-slate-400 bg-clip-text text-transparent">
              Create Summary
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <Sparkles className="w-4 h-4 text-yellow-500" />
              <p className="text-slate-600 dark:text-slate-300">
                Upload your file and let Testifi AI summarize it for you.
              </p>
            </div>
          </div>
        </div>

        {/* feature bar */}
        <div className="flex items-center gap-6 mt-4 pt-4 border-t border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Shield className="w-4 h-4 text-green-500" />
            <span>Enterprise Security</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Sparkles className="w-4 h-4 text-yellow-500" />
            <span>AI-Powered Analysis</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <FileText className="w-4 h-4 text-blue-500" />
            <span>Professional Output</span>
          </div>
        </div>
      </header>

      {/* ───────── form ───────── */}
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* SummaryForm now handles its own post-upload routing */}
          <SummaryForm file={file} />
        </div>
      </main>
    </AuthenticatedLayout>
  );
};

export default CreateSummary;
