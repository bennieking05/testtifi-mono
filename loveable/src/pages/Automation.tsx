
import React from "react";
import { AuthenticatedLayout } from "@/components/layout/AuthenticatedLayout";

const Automation = () => {
  return (
    <AuthenticatedLayout>
      <main className="flex-1 px-4 lg:px-8 py-4 lg:py-8 pt-20 lg:pt-8 pb-8">
        <header className="mb-6">
          <h1 className="text-2xl lg:text-3xl font-bold mb-2 text-slate-900 dark:text-slate-100">
            Process Automation
          </h1>
          <p className="text-sm lg:text-base text-slate-600 dark:text-slate-300">
            Set up automation rules for your summary workflows
          </p>
        </header>

        <div className="mt-10 max-w-4xl mx-auto text-center">
          <div className="bg-blue-50 dark:bg-slate-800 rounded-lg p-8 shadow-sm border border-blue-100 dark:border-slate-700">
            <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">Automation Coming Soon</h2>
            <p className="text-gray-600 dark:text-slate-300 mb-6">
              We're working on powerful automation features to help streamline your document processing workflow. 
              Check back soon for updates!
            </p>
          </div>
        </div>
      </main>
    </AuthenticatedLayout>
  );
};

export default Automation;
