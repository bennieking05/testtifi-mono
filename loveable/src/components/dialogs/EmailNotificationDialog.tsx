// ─── EmailNotificationDialog.tsx ─────────────────────────────────────────────
import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mail, Clock, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import api from "@/lib/axios";

interface EmailNotificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summaryId: string;
  summaryName: string;
}

export const EmailNotificationDialog: React.FC<
  EmailNotificationDialogProps
> = ({ open, onOpenChange, summaryId, summaryName }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [optedIn, setOptedIn] = useState(false); // prevent double-opt-in
  const { toast } = useToast();

  const handleOptIn = async () => {
    if (optedIn) return; // guard against double-clicks
    setIsSubmitting(true);

    try {
      const response = await api.post("/api/email-notifications", {
        summaryId,
        notifyOnComplete: true,
      });

      if (response.status === 200) {
        setOptedIn(true);
        toast({
          title: "Email notifications enabled",
          description: `You'll receive an email when "${summaryName}" is ready.`,
        });
        // keep button disabled now that the opt-in succeeded
      } else if (response.status === 404) {
        toast({
          title: "Summary not found",
          description:
            "We couldn't locate that summary job. Please refresh and try again.",
          variant: "destructive",
        });
      } else {
        throw new Error("Failed to enable notifications");
      }
    } catch (error) {
      toast({
        title: "Error",
        description:
          "Failed to enable email notifications. Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
      onOpenChange(false);
    }
  };

  const handleSkip = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700">
        <DialogHeader className="text-center">
          <div className="mx-auto mb-4 p-3 bg-gradient-to-br from-[#5674BC] to-[#4a65a7] rounded-full w-fit">
            <Mail className="w-6 h-6 text-white" />
          </div>
          <DialogTitle className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Get notified when ready
          </DialogTitle>
          <DialogDescription className="text-center space-y-3">
            <div className="flex items-center justify-center gap-2 text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 px-3 py-2 rounded-lg">
              <Clock className="w-4 h-4" />
              <span className="text-sm font-medium">
                Depositions can take up to 15-20&nbsp;minutes to summarize
              </span>
            </div>
            <p className="text-gray-600 dark:text-slate-300">
              Would you like to receive an email notification when "
              {summaryName}" is ready for download?
            </p>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <Button
            variant="outline"
            onClick={handleSkip}
            disabled={isSubmitting || optedIn}
            className="w-full sm:w-auto border-gray-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-800"
          >
            Skip
          </Button>
          <Button
            onClick={handleOptIn}
            disabled={isSubmitting || optedIn}
            className="w-full sm:w-auto bg-gradient-to-r from-[#5674BC] to-[#4a65a7] text-white hover:from-[#4a65a7] hover:to-[#3a518c]"
          >
            {isSubmitting ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Enabling…
              </div>
            ) : optedIn ? (
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Enabled
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Yes, notify me
              </div>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
