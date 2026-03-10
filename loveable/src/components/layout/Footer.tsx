
import React from "react";
import { Link } from "react-router-dom";

export const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="w-full bg-white dark:bg-slate-900 border-t border-[rgba(86,116,188,0.5)] dark:border-slate-700 py-4 px-6">
      <div className="flex flex-col md:flex-row justify-between items-center">
        <div className="text-sm text-gray-600 dark:text-slate-400 mb-2 md:mb-0">
          © {currentYear} Testifi AI. All rights reserved.
        </div>
        <div className="flex gap-6">
          <a
            href="https://testifi.ai/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[#5674BC] dark:text-blue-400 hover:text-[#3a518c] dark:hover:text-blue-300 transition-colors"
          >
            Terms of Service
          </a>
          <a
            href="https://testifi.ai/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[#5674BC] dark:text-blue-400 hover:text-[#3a518c] dark:hover:text-blue-300 transition-colors"
          >
            Privacy Policy
          </a>
          <Link
            to="/help"
            className="text-sm text-[#5674BC] dark:text-blue-400 hover:text-[#3a518c] dark:hover:text-blue-300 transition-colors"
          >
            Help
          </Link>
          <Link
            to="/support"
            className="text-sm text-[#5674BC] dark:text-blue-400 hover:text-[#3a518c] dark:hover:text-blue-300 transition-colors"
          >
            Support
          </Link>
        </div>
      </div>
    </footer>
  );
};
