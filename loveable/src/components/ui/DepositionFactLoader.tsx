import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// UAT R46: the rotating "Did you know?" deposition fact card was removed —
// this is now a plain spinner + message loader.
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
          <p className="text-slate-700 dark:text-slate-300 font-medium">
            {message}
          </p>
        )}
      </div>
    </div>
  );
};

export default DepositionFactLoader;

