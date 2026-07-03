// src/worker/stages/index.ts
// Orchestrates the multi-stage summary pipeline

export { countPages, splitPages, detectTranscriptMaxPage, chooseTotalTranscriptPages } from "./pageCounter";
export type { PageCountResult, PageCountInput } from "./pageCounter";

export { extractMetadata, extractLegalMetadata } from "./metadataExtractor";
export type { MetadataResult, MetadataInput } from "./metadataExtractor";

export { summarizePages, groupPagesToChunks, sanitizeGeneratedMarkdown, trimOutOfRangeRows } from "./pageSummarizer";
export type { SummarizerResult, SummarizerInput, SummaryRow } from "./pageSummarizer";




