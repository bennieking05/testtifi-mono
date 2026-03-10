import React from "react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  onCreate?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onCreate }) => {
  return (
    <div className="flex flex-col items-center px-0 py-[75px]">
      <div className="text-center max-w-2xl">
        {/* Professional icon with enhanced styling */}
        <svg
          className="mx-auto mb-8"
          width="180"
          height="180"
          viewBox="0 0 180 180"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <g clipPath="url(#clip0_31_1097)">
            <path
              d="M178.519 22.718C178.412 22.6174 157.268 2.45354 157.268 2.45354C156.46 1.678 155.624 0.876434 154.063 0.876434H68.9429C66.4566 0.876434 64.4338 2.89897 64.4338 5.38522V19.2308L34.4332 24.3735C32.0285 24.7953 30.4113 27.0967 30.8279 29.4989L32.3505 38.3766C22.5992 41.658 12.5878 45.0408 2.92297 48.5125C0.639222 49.3474 -0.559255 51.8867 0.255667 54.1842L19.4809 107.627C19.8676 108.703 20.8811 109.372 21.9622 109.372C22.2582 109.372 22.5598 109.322 22.8545 109.216C24.2248 108.723 24.9361 107.213 24.4432 105.842L5.50239 53.1896C14.6079 49.9296 24.0375 46.7388 33.253 43.637L42.3131 96.4575L52.7383 157.289C53.1149 159.436 55.0024 160.964 57.1329 160.964C57.374 160.964 57.6187 160.945 57.8641 160.904L86.1002 156.059L108.164 152.276L74.9799 164.204L48.8114 173.613L28.4882 117.085C27.9957 115.715 26.4857 115.004 25.115 115.496C23.7446 115.989 23.0334 117.499 23.5259 118.87L44.1373 176.2C44.7965 178.003 46.5044 179.124 48.3097 179.124C48.8086 179.124 49.3152 179.038 49.8088 178.858L76.7634 169.167L137.968 147.168L149.661 145.164H175.491C177.977 145.164 180 143.137 180 140.645V25.689C180 24.1108 179.144 23.3058 178.519 22.718Z"
              fill="#5674BC"
              className="dark:fill-blue-400"
            />
            <path
              d="M82.417 41.818C82.417 43.2742 83.5975 44.4547 85.0537 44.4547H160.441C161.898 44.4547 163.078 43.2742 163.078 41.818C163.078 40.3618 161.898 39.1813 160.441 39.1813H85.0537C83.5975 39.1813 82.417 40.3618 82.417 41.818Z"
              fill="#5674BC"
              className="dark:fill-blue-400"
            />
            <path
              d="M160.441 57.9132H85.0537C83.5975 57.9132 82.417 59.0938 82.417 60.55C82.417 62.0061 83.5975 63.1867 85.0537 63.1867H160.441C161.898 63.1867 163.078 62.0061 163.078 60.55C163.078 59.0938 161.898 57.9132 160.441 57.9132Z"
              fill="#5674BC"
              className="dark:fill-blue-400"
            />
            <path
              d="M160.441 76.6452H85.0537C83.5975 76.6452 82.417 77.8257 82.417 79.2819C82.417 80.7381 83.5975 81.9186 85.0537 81.9186H160.441C161.898 81.9186 163.078 80.7381 163.078 79.2819C163.078 77.8257 161.898 76.6452 160.441 76.6452Z"
              fill="#5674BC"
              className="dark:fill-blue-400"
            />
            <path
              d="M160.441 95.3771H85.0537C83.5975 95.3771 82.417 96.5577 82.417 98.0139C82.417 99.47 83.5975 100.651 85.0537 100.651H160.441C161.898 100.651 163.078 99.47 163.078 98.0139C163.078 96.5577 161.898 95.3771 160.441 95.3771Z"
              fill="#5674BC"
              className="dark:fill-blue-400"
            />
            <path
              d="M160.441 114.109H85.0537C83.5975 114.109 82.417 115.29 82.417 116.746C82.417 118.202 83.5975 119.383 85.0537 119.383H160.441C161.898 119.383 163.078 118.202 163.078 116.746C163.078 115.29 161.898 114.109 160.441 114.109Z"
              fill="#5674BC"
              className="dark:fill-blue-400"
            />
          </g>
        </svg>

        <div className="space-y-4">
          <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Ready to Create a Professional Summary?
          </h3>

          <p className="text-base text-slate-700 dark:text-slate-300 leading-relaxed">
            Upload your transcript to generate a comprehensive, professional-grade
            summary that saves hours of review time and keeps every key detail
            front and center.
          </p>

          {onCreate && (
            <Button
              onClick={onCreate}
              className="bg-gradient-to-r from-[#5674BC] to-[#4a65a7] text-white shadow-lg hover:shadow-xl transition-shadow mt-4"
            >
              Create a Summary
            </Button>
          )}

          <div className="flex flex-wrap justify-center gap-4 mt-8 text-sm">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="font-semibold text-blue-900 dark:text-blue-100 mb-1">
                🚀 Save 165+ Minutes
              </div>
              <div className="text-blue-700 dark:text-blue-300">
                Per deposition summary
              </div>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
              <div className="font-semibold text-green-900 dark:text-green-100 mb-1">
                📄 Professional-Grade Output
              </div>
              <div className="text-green-700 dark:text-green-300">
                Attorney-ready formatting
              </div>
            </div>
            <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg border border-purple-200 dark:border-purple-800">
              <div className="font-semibold text-purple-900 dark:text-purple-100 mb-1">
                🔒 Enterprise Security
              </div>
              <div className="text-purple-700 dark:text-purple-300">
                Bank-level protection
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
