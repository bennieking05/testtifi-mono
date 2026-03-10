import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  Home,
  FileText,
  CreditCard,
  Shield,
  HelpCircle,
  MessageCircle,
  Plus,
  Upload,
  ChevronLeft,
  ChevronRight,
  LogOut,
  X,
  Briefcase,
  Brain,
  Users,
  Receipt,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axios";

interface UserData {
  credits: number;
  name: string;
  role: string;
}

const getInitials = (name: string): string =>
  name
    ? name
        .trim()
        .split(" ")
        .filter(Boolean)
        .map((w) => w[0].toUpperCase())
        .join("")
    : "U";

const makeIsActive =
  (pathname: string) =>
  (path: string): boolean => {
    if (path === "/") return pathname === "/";
    return pathname === path || pathname.startsWith(path + "/");
  };

export const Sidebar: React.FC<{
  show?: boolean;
  onClose?: () => void;
}> = ({ show = true, onClose }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = makeIsActive(location.pathname);
  const [collapsed, setCollapsed] = useState(false);

  const { data: user } = useQuery<UserData>({
    queryKey: ["user"],
    queryFn: async () => {
      const { data } = await api.get("/api/user");
      return data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!localStorage.getItem("token"),
  });

  const isAdmin = user?.role === "admin";
  const displayedTokens = user?.credits ?? 0;

  const handleLogout = () => {
    ["token", "credits", "refreshToken"].forEach((k) =>
      localStorage.removeItem(k)
    );
    navigate("/login");
  };

  const handleAddTokens = () => navigate("/payment");

  return (
    <>
      {show && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 left-0 z-50 h-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-r border-[rgba(86,116,188,0.5)] dark:border-slate-700 transition-transform duration-300 ease-in-out ${
          show ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0 flex flex-col ${collapsed ? "w-16" : "w-[286px]"}`}
      >
        {/* Mobile close */}
        <div className="lg:hidden absolute top-4 right-4 z-50">
          <button
            onClick={onClose}
            className="text-[#5674BC] dark:text-blue-400 p-1 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-md transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Logo & Collapse */}
        <div className="relative flex items-center justify-center flex-shrink-0 px-4 py-0 leading-none">
          {collapsed ? (
            <>
              {/* collapsed: light-mode icon */}
              <img
                src={`${import.meta.env.BASE_URL}lovable-uploads/e538c9b5-436d-4d45-95b4-249d6392f603.png`}
                alt="Minimized Logo"
                className="block w-12 h-12 object-contain dark:hidden"
              />
              {/* collapsed: dark-mode icon */}
              <img
                src={`${import.meta.env.BASE_URL}testifi_dark_icon.png`}
                alt="Testifi AI Icon"
                className="hidden w-12 h-12 object-contain dark:block"
              />
            </>
          ) : (
            <div className="w-[240px] h-[78px] flex items-center justify-center">
              <picture className="flex-1">
                {/* expanded: dark-mode full logo */}
                <source
                  srcSet="/testifi_dark_logo.png"
                  media="(prefers-color-scheme: dark)"
                />
                {/* expanded: light-mode full logo */}
                <img
                  src="https://cdn.builder.io/api/v1/image/assets/TEMP/c9c3dfc31128154f7890d687bf44294f87da8895"
                  alt="Testifi AI Logo"
                  className="block h-full w-auto object-contain"
                />
              </picture>
            </div>
          )}

          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`
      absolute top-1/2 transform -translate-y-1/2
      bg-white dark:bg-slate-800
      border border-[rgba(86,116,188,0.5)] dark:border-slate-700
      rounded-full w-6 h-6 flex items-center justify-center
      z-10 hidden lg:flex shadow-sm hover:shadow-md transition-shadow
      ${collapsed ? "left-16" : "right-4"}
    `}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4 text-[#5674BC] dark:text-blue-400" />
            ) : (
              <ChevronLeft className="h-4 w-4 text-[#5674BC] dark:text-blue-400" />
            )}
          </button>
        </div>

        <div className="w-full h-px bg-[rgba(86,116,188,0.5)] dark:bg-slate-700" />

        {/* Navigation - takes up available space with scroll */}
        <nav className="pt-5 pb-2.5 flex-1 overflow-y-auto">
          <SidebarLink to="/dashboard" icon={Home} active={isActive("/dashboard")}>
            Dashboard
          </SidebarLink>

          <SidebarLink
            to="/summaries"
            icon={FileText}
            active={isActive("/summaries")}
          >
            AI Generated Summary
          </SidebarLink>

          {/* <SidebarLink
            to="/case-preparation"
            icon={Briefcase}
            active={isActive("/case-preparation")}
          >
            Case Preparation
          </SidebarLink>

          <SidebarLink
            to="/ai-insights"
            icon={Brain}
            active={isActive("/ai-insights")}
          >
            AI Insights
          </SidebarLink>

          <SidebarLink
            to="/collaboration"
            icon={Users}
            active={isActive("/collaboration")}
          >
            Team Collaboration
          </SidebarLink> */}

          <SidebarLink
            to="/payment"
            icon={CreditCard}
            active={isActive("/payment")}
          >
            Purchase Tokens
          </SidebarLink>

          <SidebarLink
            to="/account/billing"
            icon={Receipt}
            active={isActive("/account/billing")}
          >
            Billing History
          </SidebarLink>

          {isAdmin && (
            <>
              <SidebarLink
                to="/admin"
                icon={Shield}
                active={isActive("/admin")}
              >
                Admin Dashboard
              </SidebarLink>
              <SidebarLink
                to="/admin/finetune"
                icon={Upload}
                active={isActive("/admin/finetune")}
              >
                Fine-tune Model
              </SidebarLink>
            </>
          )}
        </nav>

        {/* Footer - always at bottom */}
        <div className="flex-shrink-0 border-t border-[rgba(86,116,188,0.1)] dark:border-slate-700">
          <div className="p-5 flex items-center justify-between">
            {!collapsed && (
              <div className="text-base font-semibold text-[#5674BC] dark:text-blue-400">
                {displayedTokens === 1
                  ? `Summary token: ${displayedTokens}`
                  : `Summary tokens: ${displayedTokens}`}
              </div>
            )}
            <button
              onClick={handleAddTokens}
              className="w-[30px] h-[30px] bg-[#5674BC] dark:bg-blue-600 text-white rounded flex items-center justify-center hover:bg-[#4a65a7] dark:hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center p-5 bg-gray-50/50 dark:bg-slate-800/50">
            <div className="w-[30px] h-[30px] bg-[#D9D9D9] dark:bg-slate-700 text-[#5674BC] dark:text-blue-400 rounded-full flex items-center justify-center text-sm font-medium">
              <span>{getInitials(user?.name || "")}</span>
            </div>
            {!collapsed && (
              <div className="ml-2 text-[#5674BC] dark:text-blue-400 font-semibold">
                {user?.name || "User"}
              </div>
            )}
          </div>

          <SidebarLink
            to="/help"
            icon={HelpCircle}
            active={isActive("/help")}
            bottom
          >
            Help center
          </SidebarLink>

          <SidebarLink
            to="/support"
            icon={MessageCircle}
            active={isActive("/support")}
            bottom
          >
            Support
          </SidebarLink>

          <button
            onClick={handleLogout}
            className="flex items-center p-5 w-full text-black dark:text-white hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
          >
            <LogOut className="h-5 w-5 text-[#5674BC] dark:text-blue-400" />
            {!collapsed && (
              <span className="ml-2 text-base font-medium">Logout</span>
            )}
          </button>
        </div>
      </aside>
    </>
  );

  function SidebarLink({
    to,
    icon: Icon,
    active,
    children,
    bottom = false,
  }: {
    to: string;
    icon: React.ElementType;
    active: boolean;
    children: React.ReactNode;
    bottom?: boolean;
  }) {
    return (
      <Link
        to={to}
        onClick={() => onClose?.()}
        className={`flex items-center p-5 text-black dark:text-white transition-colors ${
          active
            ? "bg-[rgba(86,116,188,0.1)] dark:bg-blue-500/20 border-r-2 border-[#5674BC] dark:border-blue-400"
            : ""
        } ${bottom ? "" : "hover:bg-gray-50 dark:hover:bg-slate-800"}`}
      >
        <Icon className="h-5 w-5 text-[#5674BC] dark:text-blue-400" />
        {!collapsed && <span className="ml-2 text-base">{children}</span>}
      </Link>
    );
  }
};
