
import React, { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Footer } from "./Footer";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";

interface AuthenticatedLayoutProps {
  children: React.ReactNode;
}

export const AuthenticatedLayout: React.FC<AuthenticatedLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      <div className="fixed inset-0 pattern-grid-black dark:pattern-grid-white opacity-30 pointer-events-none" />
      
      {/* Mobile menu button - fixed position */}
      <div className="lg:hidden fixed top-4 left-4 z-[10060]">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSidebarOpen(true)}
          className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm shadow-lg border-white/50 dark:border-slate-700/50"
        >
          <Menu className="w-4 h-4" />
        </Button>
      </div>

      {/* Fixed Sidebar */}
      <Sidebar 
        show={sidebarOpen} 
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
      />
      
      {/* Main Content Area with dynamic margin based on sidebar state */}
      <div 
        className={`flex flex-col flex-1 min-h-screen pt-16 transition-all duration-300 ${
          sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-[286px]'
        } lg:pt-0`}
      >
        <div className="flex-1 relative z-10">
          {children}
        </div>
        <Footer />
      </div>
    </div>
  );
};
