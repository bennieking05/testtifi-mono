import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { AuthenticatedLayout } from "@/components/layout/AuthenticatedLayout";
import { PlanCard } from "@/components/payment/PlanCard";
import { Info, Shield, Users, Award } from "lucide-react";

const Payment = () => {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  const location = useLocation() as {
    state?: { returnTo?: string; reason?: string };
  };

  useEffect(() => {
    if (location.state?.reason) {
      toast({
        title: "Payment required",
        description: location.state.reason,
        duration: 7000,
      });
    }
  }, [location.state?.reason, toast]);

  const plans = [
    {
      id: "individual",
      name: "Individual Summary",
      credits: 1,
      price: 125.0,
      description: "Perfect for solo practitioners and small cases",
      additionalInfo:
        "Includes 1 comprehensive deposition summary with full narrative format, key insights, and PDF download",
    },
    {
      id: "basic",
      name: "Basic Package",
      credits: 10,
      price: 1200.0,
      description: "Ideal for small to medium law firms",
      additionalInfo:
        "Includes 10 deposition summaries • $120 per additional summary",
    },
    {
      id: "plus",
      name: "Select Package",
      credits: 25,
      price: 2750.0,
      description: "Comprehensive solution for active litigation teams",
      additionalInfo:
        "Includes 25 deposition summaries • $110 per additional summary • Priority processing • Account management",
      popular: true,
    },
    {
      id: "premium",
      name: "Premium Package",
      credits: 50,
      price: 5000.0,
      description: "Complete solution for large practices and complex cases",
      additionalInfo:
        "Includes 50 deposition summaries • $100 per additional summary • Dedicated support • Custom integrations available",
    },
  ];

  const handleSelectPlan = (planId: string) => setSelectedPlan(planId);

  const handleProceedToCheckout = () => {
    if (!selectedPlan) {
      toast({
        title: "No plan selected",
        description: "Please select a plan to continue",
        variant: "destructive",
      });
      return;
    }

    const planDetails = plans.find((p) => p.id === selectedPlan);
    if (!planDetails) {
      toast({
        title: "Error",
        description: "Invalid plan selected.",
        variant: "destructive",
      });
      return;
    }

    navigate("/checkout", {
      state: {
        plan: planDetails,
        ...(location.state?.returnTo
          ? { returnTo: location.state.returnTo }
          : {}),
      },
    });
  };

  return (
    <AuthenticatedLayout>
      <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1600px] mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl sm:text-[28px] font-bold mb-2 text-slate-900 dark:text-slate-100">
            Professional Summary Packages
          </h1>
          <p className="text-sm sm:text-base text-black dark:text-slate-300 max-w-4xl">
            Choose the right package for your practice. Testifi AI delivers
            professional-grade deposition summaries that help you save time,
            increase accuracy, and focus on what matters most – winning cases.
          </p>
        </header>

        <div className="w-full max-w-64 h-px bg-[rgba(86,116,188,0.5)] dark:bg-slate-700 mb-6" />

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 flex items-center gap-3">
            <Award className="text-green-600 dark:text-green-400 h-6 w-6 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-green-900 dark:text-green-100 text-sm">
                Accuracy
              </h3>
              <p className="text-xs text-green-700 dark:text-green-300">
                Professional-grade AI summaries
              </p>
            </div>
          </div>
          <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4 flex items-center gap-3">
            <Users className="text-purple-600 dark:text-purple-400 h-6 w-6 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-purple-900 dark:text-purple-100 text-sm">
                Trusted by 500+
              </h3>
              <p className="text-xs text-purple-700 dark:text-purple-300">
                Legal professionals nationwide
              </p>
            </div>
          </div>
        </div>

        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-4 mb-6 flex items-start gap-3">
          <Info className="text-amber-500 dark:text-amber-400 h-5 w-5 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm text-amber-800 dark:text-amber-200">
              <strong>Sales Policy:</strong> All sales are final. No refunds or exchanges.
              Summary credits expire three (3) days from purchase date. Unused credits
              cannot be recovered.
            </p>
          </div>
        </div>

        <h2 className="text-lg sm:text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">
          Professional Packages
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-6">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isSelected={selectedPlan === plan.id}
              onSelect={handleSelectPlan}
            />
          ))}
        </div>

        <div className="mt-8 lg:mt-10 max-w-md mx-auto pb-8">
          <Button
            onClick={handleProceedToCheckout}
            className="w-full bg-[#5674BC] hover:bg-[#4a65a7] text-white py-5 sm:py-6 text-base sm:text-lg"
            disabled={!selectedPlan}
          >
            Proceed to Secure Checkout
          </Button>

          <div className="mt-4 text-center text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            <p>🔒 Secure payment powered by Stripe • PCI DSS compliant</p>
            <p className="mt-2">
              Questions? Contact our enterprise support team at{" "}
              <a
                href="mailto:support@testifi.ai"
                className="text-[#5674BC] dark:text-blue-400 hover:underline"
              >
                support@testifi.ai
              </a>
            </p>
          </div>
        </div>
      </main>
    </AuthenticatedLayout>
  );
};

export default Payment;
