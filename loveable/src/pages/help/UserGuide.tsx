import React from "react";
import { Link } from "react-router-dom";
import { AuthenticatedLayout } from "@/components/layout/AuthenticatedLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ArrowLeft, Upload, Eye, Download, CreditCard, HelpCircle } from "lucide-react";
import api from "@/lib/axios";

const UserGuide = () => {
  React.useEffect(() => {
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const lines: string[] = [];
      let n: Node | null;
      while ((n = walker.nextNode())) {
        const t = (n.textContent || "").replace(/\s+/g, " ").trim();
        if (t.length > 1) lines.push(t);
      }
      api.post("/api/webcopy", { route: "/help/user-guide", lines }).catch(() => {});
    } catch {}
  }, []);

  return (
    <AuthenticatedLayout>
      <main className="flex-1 px-4 lg:px-8 py-4 lg:py-8 pt-20 lg:pt-8 pb-8">
        <div className="max-w-4xl mx-auto">
          <Link
            to="/help"
            className="inline-flex items-center gap-2 text-sm text-[#5674BC] dark:text-blue-400 hover:underline mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Help Center
          </Link>

          <header className="mb-8">
            <h1 className="text-2xl lg:text-3xl font-bold mb-2 text-slate-900 dark:text-slate-100">
              User Guide
            </h1>
            <p className="text-sm lg:text-base text-slate-600 dark:text-slate-300">
              Step-by-step walkthroughs for creating, previewing, and exporting deposition summaries
            </p>
          </header>

          {/* Overview Section */}
          <Card className="mb-6 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border-white/50 dark:border-slate-700/50 shadow-lg">
            <CardHeader>
              <CardTitle className="text-slate-900 dark:text-slate-100">What is Testifi AI?</CardTitle>
              <CardDescription className="text-slate-600 dark:text-slate-300">
                An overview of the platform
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-slate-700 dark:text-slate-300 space-y-4">
              <p>
                Testifi AI is an intelligent deposition summarization platform designed for legal professionals. 
                It transforms lengthy deposition transcripts into concise, citation-accurate summaries that 
                preserve page and line references for easy verification.
              </p>
              <p>
                Our AI-powered system processes your transcripts and generates professional-grade summaries 
                with a two-column page-line format, making it easy to reference the original testimony.
              </p>
            </CardContent>
          </Card>

          {/* Step-by-Step Guides */}
          <Card className="mb-6 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border-white/50 dark:border-slate-700/50 shadow-lg">
            <CardHeader>
              <CardTitle className="text-slate-900 dark:text-slate-100">Step-by-Step Guides</CardTitle>
              <CardDescription className="text-slate-600 dark:text-slate-300">
                Learn how to use each feature
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="create" className="border-slate-200 dark:border-slate-700">
                  <AccordionTrigger className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:no-underline">
                    <div className="flex items-center gap-3">
                      <Upload className="h-5 w-5 text-[#5674BC] dark:text-blue-400" />
                      Creating a New Summary
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-slate-600 dark:text-slate-300 space-y-3 pl-8">
                    <ol className="list-decimal list-inside space-y-2">
                      <li>Navigate to <strong>Create Summary</strong> from the sidebar menu</li>
                      <li>Click the upload area or drag and drop your transcript file (PDF, DOCX, or TXT)</li>
                      <li>Enter a descriptive name for your summary</li>
                      <li>Optionally enable email notification to be alerted when processing completes</li>
                      <li>Click <strong>Create Summary</strong> to begin processing</li>
                    </ol>
                    <p className="text-slate-500 dark:text-slate-400 italic">
                      Processing typically takes 15–20 minutes depending on document length.
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="preview" className="border-slate-200 dark:border-slate-700">
                  <AccordionTrigger className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:no-underline">
                    <div className="flex items-center gap-3">
                      <Eye className="h-5 w-5 text-[#5674BC] dark:text-blue-400" />
                      Previewing Summaries
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-slate-600 dark:text-slate-300 space-y-3 pl-8">
                    <ol className="list-decimal list-inside space-y-2">
                      <li>Go to <strong>My Summaries</strong> to view all your summaries</li>
                      <li>Find the summary you want to preview (completed summaries show a checkmark)</li>
                      <li>Click on the summary row to open the detail view</li>
                      <li>Use the preview button to see a full-screen view of your summary</li>
                      <li>Press <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-xs">Escape</kbd> to close the preview</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="export" className="border-slate-200 dark:border-slate-700">
                  <AccordionTrigger className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:no-underline">
                    <div className="flex items-center gap-3">
                      <Download className="h-5 w-5 text-[#5674BC] dark:text-blue-400" />
                      Exporting Summaries
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-slate-600 dark:text-slate-300 space-y-3 pl-8">
                    <ol className="list-decimal list-inside space-y-2">
                      <li>Open a completed summary from <strong>My Summaries</strong></li>
                      <li>Click the <strong>Download</strong> button</li>
                      <li>Select your preferred format: PDF, DOCX, TXT, or CSV</li>
                      <li>The exported file includes a professional cover page and the two-column page-line summary table</li>
                    </ol>
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg mt-2">
                      <p className="font-medium text-blue-800 dark:text-blue-300">Export Formats:</p>
                      <ul className="list-disc list-inside mt-1 text-blue-700 dark:text-blue-400">
                        <li><strong>PDF</strong> – Best for printing and sharing</li>
                        <li><strong>DOCX</strong> – Editable in Microsoft Word</li>
                        <li><strong>TXT</strong> – Plain text for simple use cases</li>
                        <li><strong>CSV</strong> – Spreadsheet format for data analysis</li>
                      </ul>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="credits" className="border-slate-200 dark:border-slate-700">
                  <AccordionTrigger className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:no-underline">
                    <div className="flex items-center gap-3">
                      <CreditCard className="h-5 w-5 text-[#5674BC] dark:text-blue-400" />
                      Managing Summary Credits
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-slate-600 dark:text-slate-300 space-y-3 pl-8">
                    <p>
                      Summary credits are used each time you process a new deposition transcript. 
                      Credits are calculated based on the document's content to ensure fair pricing.
                    </p>
                    <ul className="list-disc list-inside space-y-2">
                      <li>View your current credit balance in the sidebar or on the Payment page</li>
                      <li>Purchase additional credits from the <strong>Payment</strong> page</li>
                      <li>Credits are applied automatically when you create a new summary</li>
                      <li>Credits do not expire</li>
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>

          {/* Troubleshooting */}
          <Card className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border-white/50 dark:border-slate-700/50 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <HelpCircle className="h-5 w-5 text-[#5674BC] dark:text-blue-400" />
                Troubleshooting
              </CardTitle>
              <CardDescription className="text-slate-600 dark:text-slate-300">
                Common issues and solutions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="upload-fail" className="border-slate-200 dark:border-slate-700">
                  <AccordionTrigger className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:no-underline">
                    My upload failed or is stuck
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-slate-600 dark:text-slate-300 space-y-2">
                    <p>If your upload fails:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Ensure your file is in PDF, DOCX, or TXT format</li>
                      <li>Check that the file size is under the limit</li>
                      <li>Try refreshing the page and uploading again</li>
                      <li>If the problem persists, <Link to="/support" className="text-[#5674BC] dark:text-blue-400 hover:underline">contact support</Link></li>
                    </ul>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="citations" className="border-slate-200 dark:border-slate-700">
                  <AccordionTrigger className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:no-underline">
                    Page/line citations don't match my transcript
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-slate-600 dark:text-slate-300 space-y-2">
                    <p>Citation accuracy depends on clear page markers in your source document:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Ensure your transcript has clear page numbers</li>
                      <li>OCR quality affects citation accuracy – use clean, high-resolution scans</li>
                      <li>Standard deposition transcript formatting works best</li>
                    </ul>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="processing" className="border-slate-200 dark:border-slate-700">
                  <AccordionTrigger className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:no-underline">
                    Processing is taking longer than expected
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-slate-600 dark:text-slate-300 space-y-2">
                    <p>Processing time varies based on document length:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Most documents complete within 15–20 minutes</li>
                      <li>Longer transcripts (100+ pages) may take up to 30 minutes</li>
                      <li>Enable email notifications to be alerted when complete</li>
                      <li>You can safely navigate away – processing continues in the background</li>
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        </div>
      </main>
    </AuthenticatedLayout>
  );
};

export default UserGuide;

