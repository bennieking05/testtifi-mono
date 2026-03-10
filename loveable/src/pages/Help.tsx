
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
import { Badge } from "@/components/ui/badge";
import { FileQuestion, BookOpen, MessageSquareText, Video, MapPin, ArrowRight } from "lucide-react";
import api from "@/lib/axios";

const Help = () => {
  React.useEffect(() => {
    // collect visible text nodes and send to backend for /help
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const lines: string[] = [];
      let n: Node | null;
      while ((n = walker.nextNode())) {
        const t = (n.textContent || "").replace(/\s+/g, " ").trim();
        if (t.length > 1) lines.push(t);
      }
      api.post("/api/webcopy", { route: "/help", lines }).catch(() => {});
    } catch {}
  }, []);

  return (
    <AuthenticatedLayout>
      <main className="flex-1 px-4 lg:px-8 py-4 lg:py-8 pt-20 lg:pt-8 pb-8">
          <header className="mb-6">
            <h1 className="text-2xl lg:text-3xl font-bold mb-2 text-slate-900 dark:text-slate-100">
              Help Center
            </h1>
            <p className="text-sm lg:text-base text-slate-600 dark:text-slate-300">
              Find answers to common questions and learn how to use Testifi AI
            </p>
          </header>

          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border-white/50 dark:border-slate-700/50 shadow-lg">
              <CardHeader className="flex flex-row items-center gap-4">
                <FileQuestion className="h-8 w-8 text-[#5674BC] dark:text-blue-400" />
                <div>
                  <CardTitle className="text-slate-900 dark:text-slate-100">Frequently Asked Questions</CardTitle>
                  <CardDescription className="text-slate-600 dark:text-slate-300">
                    Get quick answers to common questions
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="upload" className="border-slate-200 dark:border-slate-700">
                    <AccordionTrigger className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:no-underline">
                      How to upload a transcript
                    </AccordionTrigger>
                    <AccordionContent className="text-sm text-slate-600 dark:text-slate-300">
                      Go to Create Summary → upload PDF/DOCX/TXT → name it → optionally enable email notification. Processing takes ~15–20 minutes.
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="credits" className="border-slate-200 dark:border-slate-700">
                    <AccordionTrigger className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:no-underline">
                      Understanding summary credits
                    </AccordionTrigger>
                    <AccordionContent className="text-sm text-slate-600 dark:text-slate-300">
                      We chunk by page and line to preserve citations. Your credits cover end‑to‑end processing with legal‑style output.
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="download" className="border-slate-200 dark:border-slate-700">
                    <AccordionTrigger className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:no-underline">
                      Downloading summaries
                    </AccordionTrigger>
                    <AccordionContent className="text-sm text-slate-600 dark:text-slate-300">
                      Open the completed item → Download → choose PDF/DOCX/TXT. The export includes a cover page and a two‑column page‑line table.
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="billing" className="border-slate-200 dark:border-slate-700">
                    <AccordionTrigger className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:no-underline">
                      Billing and payments
                    </AccordionTrigger>
                    <AccordionContent className="text-sm text-slate-600 dark:text-slate-300">
                      Manage your plan from the Payment page. Purchases are reflected as credits applied to new summaries.
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardContent>
            </Card>

            <Card className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border-white/50 dark:border-slate-700/50 shadow-lg">
              <CardHeader className="flex flex-row items-center gap-4">
                <BookOpen className="h-8 w-8 text-[#5674BC] dark:text-blue-400" />
                <div>
                  <CardTitle className="text-slate-900 dark:text-slate-100">Documentation</CardTitle>
                  <CardDescription className="text-slate-600 dark:text-slate-300">
                    Detailed guides and reference materials
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
                  <Link
                    to="/help/user-guide"
                    className="block p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-[#5674BC] dark:group-hover:text-blue-400">
                        User Guide
                      </h3>
                      <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-[#5674BC] dark:group-hover:text-blue-400 transition-colors" />
                    </div>
                    <p className="mt-1 text-slate-600 dark:text-slate-300">
                      Step‑by‑step walkthroughs for creating, previewing, and exporting deposition summaries, plus FAQs and troubleshooting tips.
                    </p>
                  </Link>
                  <Link
                    to="/help/keyboard-shortcuts"
                    className="block p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-[#5674BC] dark:group-hover:text-blue-400">
                        Keyboard Shortcuts
                      </h3>
                      <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-[#5674BC] dark:group-hover:text-blue-400 transition-colors" />
                    </div>
                    <p className="mt-1 text-slate-600 dark:text-slate-300">
                      Navigate faster: use ⌘B to toggle sidebar, ↑/↓ to move through items, and Enter to act.
                    </p>
                  </Link>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border-white/50 dark:border-slate-700/50 shadow-lg">
              <CardHeader className="flex flex-row items-center gap-4">
                <Video className="h-8 w-8 text-[#5674BC] dark:text-blue-400" />
                <div>
                  <CardTitle className="text-slate-900 dark:text-slate-100">Video Tutorials</CardTitle>
                  <CardDescription className="text-slate-600 dark:text-slate-300">
                    Learn by watching step-by-step videos
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
                  <div className="p-3 rounded-lg bg-slate-50/50 dark:bg-slate-700/30">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100">Getting Started</h3>
                      <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        Coming Soon
                      </Badge>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">Intro to Testifi AI, uploading, and reading your first summary.</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50/50 dark:bg-slate-700/30">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100">Advanced Features</h3>
                      <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        Coming Soon
                      </Badge>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">Entity extraction, issue spotting, and configurable export options for legal teams.</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50/50 dark:bg-slate-700/30">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100">Best Practices</h3>
                      <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        Coming Soon
                      </Badge>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">Ensure clean OCR, maintain page markers, and validate citations for accuracy.</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50/50 dark:bg-slate-700/30">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100">Tips and Tricks</h3>
                      <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        Coming Soon
                      </Badge>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">Use email notifications, snapshots, and saved exports for smooth workflows.</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border-white/50 dark:border-slate-700/50 shadow-lg">
              <CardHeader className="flex flex-row items-center gap-4">
                <MessageSquareText className="h-8 w-8 text-[#5674BC] dark:text-blue-400" />
                <div>
                  <CardTitle className="text-slate-900 dark:text-slate-100">Contact Support</CardTitle>
                  <CardDescription className="text-slate-600 dark:text-slate-300">
                    Get help from our support team
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
                  Need more help? Our support team is available Monday through
                  Friday, 9am to 5pm Eastern Time.
                </p>
                <div className="space-y-3">
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-[#5674BC] dark:text-blue-400 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-slate-600 dark:text-slate-300">
                      <div className="font-medium">Mailing Address:</div>
                      <div>P.O. Box 600876<br />Dallas, TX 75360-0876</div>
                    </div>
                  </div>
                  <Link
                    to="/support"
                    className="inline-flex items-center gap-1 text-[#5674BC] dark:text-blue-400 hover:underline text-sm font-medium"
                  >
                    Contact Support
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
    </AuthenticatedLayout>
  );
};

export default Help;
