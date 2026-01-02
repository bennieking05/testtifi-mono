// src/worker/judges/types.ts
// Shared types for judge agents

export interface JudgeResult {
  judgeName: string;
  passed: boolean;
  warnings: string[];
  instructions: string[]; // Guidance for manual review
}

export interface JudgeContext {
  jobId: string;
  pdfPageCount: number;
  transcriptMaxPage: number;
  totalPages: number;
  deponent: string;
  depositionDate: string;
  caseCaption: string;
  summaryRows: Array<{ pageLabel: string; summary: string }>;
}

export type JudgeFn = (context: JudgeContext) => JudgeResult;




