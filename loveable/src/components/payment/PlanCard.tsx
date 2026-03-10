
import React from "react";
import { Check, Shield, Clock, Award } from "lucide-react";
import { cn } from "@/lib/utils";

interface PlanProps {
  plan: {
    id: string;
    name: string;
    credits: number;
    price: number;
    description: string;
    additionalInfo?: string;
    popular?: boolean;
  };
  isSelected: boolean;
  onSelect: (planId: string) => void;
}

export const PlanCard: React.FC<PlanProps> = ({
  plan,
  isSelected,
  onSelect,
}) => {
  return (
    <div
      className={cn(
        "rounded-lg border p-6 transition-all cursor-pointer relative bg-white dark:bg-slate-800 flex flex-col h-full",
        isSelected
          ? "border-[#5674BC] dark:border-blue-400 border-2 shadow-md bg-[rgba(86,116,188,0.05)] dark:bg-blue-500/10"
          : "border-gray-200 dark:border-slate-600 hover:border-[#5674BC] dark:hover:border-blue-400",
        plan.popular
          ? "scale-105 md:translate-y-[-8px] ring-2 ring-[#5674BC] dark:ring-blue-400 ring-opacity-20"
          : ""
      )}
      onClick={() => onSelect(plan.id)}
    >
      {plan.popular && (
        <div className="absolute top-0 right-0 bg-gradient-to-r from-[#5674BC] to-blue-600 dark:from-blue-500 dark:to-blue-400 text-white py-1 px-3 rounded-bl-lg rounded-tr-lg text-xs font-semibold">
          MOST POPULAR
        </div>
      )}

      <div className={cn("mb-4", plan.popular && "pt-5")}>
        <h3 className="text-xl font-bold text-gray-900 dark:text-slate-100">
          {plan.name}
        </h3>
        <p className="text-sm text-gray-600 dark:text-slate-300 mt-1">
          {plan.description}
        </p>
      </div>

      <div className="mb-4">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-gray-900 dark:text-slate-100">
            ${plan.price.toFixed(2)}
          </span>
          <span className="text-sm text-gray-500 dark:text-slate-400">USD</span>
        </div>
        <span className="text-sm text-gray-500 dark:text-slate-400 block mt-1">
          {plan.credits === 1
            ? "One summary credit"
            : `${plan.credits} summary credits included`}{" "}
          • Plus applicable tax
        </span>
      </div>

      <div className="mb-6">
        {plan.additionalInfo && (
          <p className="text-xs text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700/50 p-3 rounded-md">
            {plan.additionalInfo}
          </p>
        )}
      </div>

      <ul className="space-y-3 mb-6 flex-grow">
        <li className="flex items-center gap-2">
          <Check className="text-[#5674BC] dark:text-blue-400 h-4 w-4 flex-shrink-0" />
          <span className="text-sm text-gray-600 dark:text-slate-300">
            Professional narrative summaries
          </span>
        </li>
        <li className="flex items-center gap-2">
          <Check className="text-[#5674BC] dark:text-blue-400 h-4 w-4 flex-shrink-0" />
          <span className="text-sm text-gray-600 dark:text-slate-300">
            Key testimony & exhibits highlighted
          </span>
        </li>
        <li className="flex items-center gap-2">
          <Check className="text-[#5674BC] dark:text-blue-400 h-4 w-4 flex-shrink-0" />
          <span className="text-sm text-gray-600 dark:text-slate-300">
            Downloadable PDF format
          </span>
        </li>
        <li className="flex items-center gap-2">
          <Shield className="text-green-500 dark:text-green-400 h-4 w-4 flex-shrink-0" />
          <span className="text-sm text-gray-600 dark:text-slate-300">
            Enterprise-grade security
          </span>
        </li>
      </ul>

      <button
        className={cn(
          "w-full py-3 rounded-md transition-colors font-medium text-sm mt-auto",
          isSelected
            ? "bg-[#5674BC] dark:bg-blue-500 text-white"
            : "bg-white dark:bg-slate-700 text-[#5674BC] dark:text-blue-400 border border-[#5674BC] dark:border-blue-400 hover:bg-[#5674BC] hover:text-white dark:hover:bg-blue-500"
        )}
      >
        {isSelected ? "Selected Plan" : "Select Plan"}
      </button>
    </div>
  );
};
