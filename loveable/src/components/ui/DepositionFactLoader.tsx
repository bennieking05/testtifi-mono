import React, { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const DEPOSITION_FACTS = [
  "The first recorded deposition in US history dates back to 1793.",
  "The average deposition lasts 4-7 hours, though complex cases can extend to multiple days.",
  "Video depositions became standard in federal courts in 1993 under Rule 30(b)(4).",
  "Over 1.5 million depositions are taken annually in the United States.",
  "The word 'deposition' comes from the Latin 'depositio,' meaning 'a laying down.'",
  "In 1938, the Federal Rules of Civil Procedure standardized deposition practices nationwide.",
  "Court reporters typically type 200-225 words per minute during depositions.",
  "The longest deposition on record lasted over 30 days across multiple sessions.",
  "Remote depositions via video became widely accepted after legal reforms in 2020.",
  "Attorneys may object during depositions, but witnesses must still answer most questions.",
  "Deposition transcripts average 200-400 pages for a full-day session.",
  "The 'deposition notice' must typically be served at least 10 days in advance.",
  "Expert witness depositions can cost $5,000-$15,000 per day in complex litigation.",
  "About 95% of civil cases settle before trial, often after key depositions.",
  "The 'Rule of Completeness' allows related statements to be read into the record.",
  "California conducts more depositions annually than any other state.",
  "Depositions were rarely used before the 1938 Federal Rules modernization.",
  "A deponent can request breaks, but cannot consult with counsel during a pending question.",
  "Written depositions (interrogatories) date back to Roman law practices.",
  "The average cost of a court reporter for a deposition is $300-$600 per hour.",
];

interface DepositionFactLoaderProps {
  message?: string;
  className?: string;
  spinnerSize?: "sm" | "md" | "lg";
  fullScreen?: boolean;
}

export const DepositionFactLoader: React.FC<DepositionFactLoaderProps> = ({
  message,
  className,
  spinnerSize = "md",
  fullScreen = true,
}) => {
  const randomFact = useMemo(() => {
    const index = Math.floor(Math.random() * DEPOSITION_FACTS.length);
    return DEPOSITION_FACTS[index];
  }, []);

  const spinnerClasses = {
    sm: "h-6 w-6",
    md: "h-10 w-10",
    lg: "h-12 w-12",
  };

  const containerClasses = fullScreen
    ? "min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900"
    : "flex items-center justify-center py-16";

  return (
    <div className={cn(containerClasses, className)}>
      <div className="text-center max-w-md px-6">
        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-16 w-16 rounded-full bg-[#5674BC]/10 dark:bg-[#5674BC]/20 animate-pulse" />
          </div>
          <Loader2
            className={cn(
              "animate-spin text-[#5674BC] mx-auto relative z-10",
              spinnerClasses[spinnerSize]
            )}
          />
        </div>
        
        {message && (
          <p className="text-slate-700 dark:text-slate-300 font-medium mb-4">
            {message}
          </p>
        )}
        
        <div className="bg-white/80 dark:bg-slate-800/80 rounded-lg px-5 py-4 border border-slate-200 dark:border-slate-700 shadow-sm">
          <p className="text-xs uppercase tracking-wider text-[#5674BC] dark:text-[#7a94cc] font-semibold mb-2">
            Did you know?
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed italic">
            "{randomFact}"
          </p>
        </div>
      </div>
    </div>
  );
};

export default DepositionFactLoader;

