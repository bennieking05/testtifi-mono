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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Keyboard, Monitor, Apple } from "lucide-react";
import api from "@/lib/axios";

const KeyboardShortcuts = () => {
  React.useEffect(() => {
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const lines: string[] = [];
      let n: Node | null;
      while ((n = walker.nextNode())) {
        const t = (n.textContent || "").replace(/\s+/g, " ").trim();
        if (t.length > 1) lines.push(t);
      }
      api.post("/api/webcopy", { route: "/help/keyboard-shortcuts", lines }).catch(() => {});
    } catch {}
  }, []);

  const shortcuts = [
    {
      action: "Toggle sidebar",
      mac: "⌘ + B",
      windows: "Ctrl + B",
      description: "Expand or collapse the sidebar navigation",
    },
    {
      action: "Close modal / preview",
      mac: "Escape",
      windows: "Escape",
      description: "Close the current modal dialog or preview window",
    },
    {
      action: "Navigate list items",
      mac: "↑ / ↓",
      windows: "↑ / ↓",
      description: "Move up or down through list items and menus",
    },
    {
      action: "Select / confirm",
      mac: "Enter",
      windows: "Enter",
      description: "Confirm selection or submit a form",
    },
    {
      action: "Cancel / go back",
      mac: "Escape",
      windows: "Escape",
      description: "Cancel current action or navigate back",
    },
  ];

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
              Keyboard Shortcuts
            </h1>
            <p className="text-sm lg:text-base text-slate-600 dark:text-slate-300">
              Navigate faster with these keyboard shortcuts
            </p>
          </header>

          {/* Shortcuts Table */}
          <Card className="mb-6 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border-white/50 dark:border-slate-700/50 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <Keyboard className="h-5 w-5 text-[#5674BC] dark:text-blue-400" />
                All Shortcuts
              </CardTitle>
              <CardDescription className="text-slate-600 dark:text-slate-300">
                Quick reference for all available keyboard shortcuts
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200 dark:border-slate-700">
                    <TableHead className="text-slate-900 dark:text-slate-100">Action</TableHead>
                    <TableHead className="text-slate-900 dark:text-slate-100">
                      <div className="flex items-center gap-2">
                        <Apple className="h-4 w-4" />
                        Mac
                      </div>
                    </TableHead>
                    <TableHead className="text-slate-900 dark:text-slate-100">
                      <div className="flex items-center gap-2">
                        <Monitor className="h-4 w-4" />
                        Windows/Linux
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shortcuts.map((shortcut, index) => (
                    <TableRow key={index} className="border-slate-200 dark:border-slate-700">
                      <TableCell className="text-slate-700 dark:text-slate-300">
                        <div>
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {shortcut.action}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {shortcut.description}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded text-sm font-mono text-slate-800 dark:text-slate-200">
                          {shortcut.mac}
                        </kbd>
                      </TableCell>
                      <TableCell>
                        <kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded text-sm font-mono text-slate-800 dark:text-slate-200">
                          {shortcut.windows}
                        </kbd>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Tips */}
          <Card className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border-white/50 dark:border-slate-700/50 shadow-lg">
            <CardHeader>
              <CardTitle className="text-slate-900 dark:text-slate-100">Tips for Keyboard Navigation</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-700 dark:text-slate-300 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <h4 className="font-semibold text-blue-800 dark:text-blue-300 mb-2">Sidebar Navigation</h4>
                  <p className="text-blue-700 dark:text-blue-400">
                    Use <kbd className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-800 rounded text-xs">⌘B</kbd> or{" "}
                    <kbd className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-800 rounded text-xs">Ctrl+B</kbd> to 
                    quickly toggle the sidebar for more screen space.
                  </p>
                </div>
                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <h4 className="font-semibold text-green-800 dark:text-green-300 mb-2">Quick Close</h4>
                  <p className="text-green-700 dark:text-green-400">
                    Press <kbd className="px-1.5 py-0.5 bg-green-100 dark:bg-green-800 rounded text-xs">Escape</kbd> to 
                    quickly close any modal or preview without using your mouse.
                  </p>
                </div>
                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                  <h4 className="font-semibold text-purple-800 dark:text-purple-300 mb-2">List Navigation</h4>
                  <p className="text-purple-700 dark:text-purple-400">
                    Use arrow keys <kbd className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-800 rounded text-xs">↑↓</kbd> to 
                    navigate through lists and <kbd className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-800 rounded text-xs">Enter</kbd> to select.
                  </p>
                </div>
                <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                  <h4 className="font-semibold text-amber-800 dark:text-amber-300 mb-2">Form Submission</h4>
                  <p className="text-amber-700 dark:text-amber-400">
                    Press <kbd className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-800 rounded text-xs">Enter</kbd> to 
                    submit forms when the submit button is focused.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </AuthenticatedLayout>
  );
};

export default KeyboardShortcuts;

