
// File: src/pages/Success.tsx
import React, { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";

const Success = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const returnTo = (location.state as any)?.returnTo;

  // When the page mounts -> bust the caches -> Sidebar refetches -> new credits appear
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ["user"] });
    qc.invalidateQueries({ queryKey: ["billing-balance"] });
  }, [qc]);

  return (
    <div className="flex w-full min-h-screen bg-white dark:bg-slate-900">
      <Sidebar />
      <main className="flex-1 px-5 py-0">
        <div className="max-w-2xl mx-auto mt-20 text-center">
          <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-3 w-fit mx-auto">
            <CheckCircle2 className="h-12 w-12 text-green-600 dark:text-green-400" />
          </div>

          <h1 className="mt-6 text-3xl font-bold text-gray-900 dark:text-slate-100">
            Payment Successful!
          </h1>

          <p className="mt-4 text-lg text-gray-600 dark:text-slate-300">
            Thank you for your purchase. Your credits have been added to your
            account.
          </p>

          <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
            A receipt has been sent to your email. All sales are final.
          </p>

          <div className="mt-8">
            <Button
              onClick={() => navigate(returnTo || "/")}
              className="bg-[#5674BC] hover:bg-[#4a65a7] text-white px-8"
            >
              {returnTo ? "Continue" : "Return to Dashboard"}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Success;
