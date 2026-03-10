import React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axios";
import { AuthenticatedLayout } from "@/components/layout/AuthenticatedLayout";
import { MainContent } from "@/components/layout/MainContent";
import { SummaryMetrics } from "@/components/summaries/SummaryMetrics";
import { SavingsChart } from "@/components/dashboard/SavingsChart";
import { Summary } from "@/components/summaries/SummaryList";
import { Button } from "@/components/ui/button";
import { ArrowRight, Plus, CreditCard, Activity, MessageCircle } from "lucide-react";

// Use same query key as Sidebar to keep token counts in sync
interface UserData {
  credits: number;
  name: string;
  role: string;
}

const Dashboard = () => {
  const navigate = useNavigate();

  const { data: summaries = [], isLoading: summariesLoading } = useQuery<Summary[]>({
    queryKey: ["dashboard-summaries"],
    queryFn: () => api.get<Summary[]>("/api/summaries").then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  // Use the same ["user"] query key as Sidebar to keep credits in sync
  const { data: userData, isLoading: userLoading } = useQuery<UserData>({
    queryKey: ["user"],
    queryFn: async () => {
      const { data } = await api.get("/api/user");
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const handleCreateSummary = () => {
    navigate("/create-summary");
  };

  const isLoading = summariesLoading || userLoading;
  const processingCount = summaries.filter(s => s.status === "processing").length;
  const credits = userData?.credits ?? 0;

  return (
    <AuthenticatedLayout>
      <MainContent>
        <div className="flex flex-col gap-6">
          {/* Welcome Banner */}
          <div className="bg-[#5674BC] rounded-2xl p-8 text-white shadow-lg overflow-hidden">
             <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                {/* Left: welcome text and CTA */}
                <div className="min-w-0 flex-1">
                  <p className="text-blue-100 text-sm font-medium mb-2 uppercase tracking-wider">Welcome Back</p>
                  <h1 className="text-3xl font-bold mb-4">Accelerate your case preparation</h1>
                  <p className="text-blue-100 max-w-2xl mb-8 text-lg">
                    Launch new summaries, monitor progress, and keep clients ahead of schedule from one central hub.
                  </p>
                  <div className="flex gap-4">
                    <Button
                      onClick={handleCreateSummary}
                      className="bg-white text-[#5674BC] hover:bg-blue-50 border-none font-semibold"
                      size="lg"
                    >
                      <Plus className="mr-2 h-5 w-5" />
                      Create summary
                    </Button>
                  </div>
                </div>
                {/* Active Jobs Widget (desktop: right side; avoids overlap at ~1300px) */}
                <div className="hidden lg:block flex-shrink-0 bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20 w-full lg:w-auto lg:min-w-[200px]">
                  <p className="text-xs text-blue-100 uppercase font-semibold mb-1">Active Jobs</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold">{processingCount.toString().padStart(2, '0')}</span>
                    <span className="text-blue-100">processing</span>
                  </div>
                  <p className="text-xs text-blue-200 mt-2">Refreshed automatically every few seconds.</p>
                </div>
             </div>
          </div>

          {/* Metrics Row */}
          <SummaryMetrics summaries={summaries} isLoading={isLoading} />

          {/* Savings Chart */}
          <SavingsChart summaries={summaries} isLoading={isLoading} />

          {/* Bottom Cards Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Available Credits */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm flex flex-col justify-between">
               <div>
                 <div className="flex justify-between items-start mb-4">
                   <p className="text-slate-500 font-medium">Available credits</p>
                   <div className="p-2 bg-blue-50 rounded-lg">
                     <CreditCard className="w-5 h-5 text-blue-600" />
                   </div>
                 </div>
                 <p className="text-4xl font-bold text-slate-900 dark:text-slate-100 mb-1">
                   {isLoading ? "..." : credits.toLocaleString()}
                 </p>
                 <p className="text-sm text-slate-500">Enough for {credits} summaries</p>
               </div>
               <Button className="w-full mt-6 bg-[#5674BC] hover:bg-[#4a65a7]" onClick={() => navigate("/payment")}>
                 Purchase credits
               </Button>
            </div>

            {/* Processing Updates */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm flex flex-col justify-between">
               <div>
                 <div className="flex justify-between items-start mb-4">
                   <p className="text-slate-500 font-medium">Processing updates</p>
                   <div className="p-2 bg-yellow-50 rounded-lg">
                     <Activity className="w-5 h-5 text-yellow-600" />
                   </div>
                 </div>
                 <p className="text-4xl font-bold text-slate-900 dark:text-slate-100 mb-1">
                   {processingCount}
                 </p>
                 <p className="text-sm text-slate-500">Jobs currently running</p>
               </div>
               <Button variant="outline" className="w-full mt-6" onClick={() => navigate("/summaries")}>
                 View processing queue
               </Button>
            </div>

            {/* Support */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm flex flex-col justify-between">
               <div>
                 <div className="flex justify-between items-start mb-4">
                   <p className="text-slate-500 font-medium">Support & guidance</p>
                   <div className="p-2 bg-green-50 rounded-lg">
                     <MessageCircle className="w-5 h-5 text-green-600" />
                   </div>
                 </div>
                 <h3 className="font-bold text-lg mb-2 text-slate-900 dark:text-slate-100">Need help from our team?</h3>
                 {/* <p className="text-sm text-slate-500">Get email alerts, talk to support, or browse docs.</p> */}
               </div>
               <div className="space-y-2 mt-6">
                 <Button variant="outline" className="w-full justify-between" onClick={() => navigate("/support")}>
                   Contact support <ArrowRight className="w-4 h-4" />
                 </Button>
                 <Button variant="ghost" className="w-full text-[#5674BC] hover:text-[#4a65a7] hover:bg-blue-50" onClick={() => navigate("/help")}>
                   Visit help center <ArrowRight className="w-4 h-4 ml-2" />
                 </Button>
               </div>
            </div>

          </div>
        </div>
      </MainContent>
    </AuthenticatedLayout>
  );
};

export default Dashboard;
