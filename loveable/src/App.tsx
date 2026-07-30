import axios from "axios"; // already configured with interceptors
import { jwtDecode } from "jwt-decode";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Register from "./pages/Register";
import NotFound from "./pages/NotFound";
import Payment from "./pages/Payment";
import Checkout from "./pages/Checkout";
import DownloadSummary from "./pages/DownloadSummary";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import CreateSummary from "./pages/CreateSummary";
import Summaries from "./pages/Summaries";
import Automation from "./pages/Automation";
import Help from "./pages/Help";
import UserGuide from "./pages/help/UserGuide";
import KeyboardShortcuts from "./pages/help/KeyboardShortcuts";
import Support from "./pages/Support";
import Admin from "./pages/Admin";
import AdminFineTune from "./pages/AdminFineTune";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import Success from "./pages/Success";
import SummaryDetail from "./pages/SummaryDetail";
import SummaryPreview from "./pages/SummaryPreview";
import { useAutoSnapshots } from "@/hooks/useAutoSnapshots";
import SecurityCommitment from "./pages/SecurityCommitment";
import CasePreparation from "./pages/CasePreparation";
import AIInsights from "./pages/AIInsights";
import Collaboration from "./pages/Collaboration";
import Billing from "./pages/Billing";
import { DepositionFactLoader } from "@/components/ui/DepositionFactLoader";
import CookieConsent from "@/components/CookieConsent";

const queryClient = new QueryClient();

// Token expiration check
function isTokenExpired(token: string): boolean {
  try {
    const decoded: any = jwtDecode(token);
    return decoded.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

// Route protection with refresh token support
function ProtectedRoute({ children }: { children: JSX.Element }) {
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem("token");
      const refreshToken = localStorage.getItem("refreshToken");

      // No tokens at all
      if (!token && !refreshToken) {
        setIsAuthenticated(false);
        setIsChecking(false);
        return;
      }

      // Token exists and is valid
      if (token && !isTokenExpired(token)) {
        setIsAuthenticated(true);
        setIsChecking(false);
        return;
      }

      // Token expired or missing, try to refresh
      if (refreshToken) {
        try {
          const baseURL = import.meta.env.VITE_API_URL || "";
          const refreshPath = `${baseURL}/api/auth/refresh-token`;
          
          const response = await axios.post(refreshPath, {
            refreshToken: refreshToken,
          });

          const newAccessToken = response.data.accessToken;
          localStorage.setItem("token", newAccessToken);
          setIsAuthenticated(true);
        } catch (error) {
          console.error("Token refresh failed:", error);
          localStorage.removeItem("token");
          localStorage.removeItem("refreshToken");
          setIsAuthenticated(false);
        }
      } else {
        // No refresh token, clear everything
        localStorage.removeItem("token");
        setIsAuthenticated(false);
      }

      setIsChecking(false);
    };

    checkAuth();
  }, []);

  if (isChecking) {
    return <DepositionFactLoader message="Checking authentication..." />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

// Calls the snapshot hook within Router context
function SnapshotProvider({ children }: { children: React.ReactNode }) {
  useAutoSnapshots();
  return <>{children}</>;
}

// Main App
const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="system" storageKey="ui-theme">
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <SnapshotProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password/:token" element={<ResetPassword />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route
              path="/security-commitment"
              element={
                <ProtectedRoute>
                  <SecurityCommitment />
                </ProtectedRoute>
              }
            />
            <Route
              path="/success"
              element={
                <ProtectedRoute>
                  <Success />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/case-preparation"
              element={
                <ProtectedRoute>
                  <CasePreparation />
                </ProtectedRoute>
              }
            />
            <Route
              path="/ai-insights"
              element={
                <ProtectedRoute>
                  <AIInsights />
                </ProtectedRoute>
              }
            />
            <Route
              path="/collaboration"
              element={
                <ProtectedRoute>
                  <Collaboration />
                </ProtectedRoute>
              }
            />
            <Route
              path="/payment"
              element={
                <ProtectedRoute>
                  <Payment />
                </ProtectedRoute>
              }
            />
            <Route
              path="/checkout"
              element={
                <ProtectedRoute>
                  <Checkout />
                </ProtectedRoute>
              }
            />
            <Route
              path="/account/billing"
              element={
                <ProtectedRoute>
                  <Billing />
                </ProtectedRoute>
              }
            />
            <Route
              path="/download/:id"
              element={
                <ProtectedRoute>
                  <DownloadSummary />
                </ProtectedRoute>
              }
            />
            <Route
              path="/create-summary"
              element={
                <ProtectedRoute>
                  <CreateSummary />
                </ProtectedRoute>
              }
            />
            <Route
              path="/summaries"
              element={
                <ProtectedRoute>
                  <Summaries />
                </ProtectedRoute>
              }
            />
            <Route
              path="/summaries/:id"
              element={
                <ProtectedRoute>
                  <SummaryDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/preview/:id"
              element={
                <ProtectedRoute>
                  <SummaryPreview />
                </ProtectedRoute>
              }
            />
            <Route
              path="/automation"
              element={
                <ProtectedRoute>
                  <Automation />
                </ProtectedRoute>
              }
            />
            <Route
              path="/help"
              element={
                <ProtectedRoute>
                  <Help />
                </ProtectedRoute>
              }
            />
            <Route
              path="/help/user-guide"
              element={
                <ProtectedRoute>
                  <UserGuide />
                </ProtectedRoute>
              }
            />
            <Route
              path="/help/keyboard-shortcuts"
              element={
                <ProtectedRoute>
                  <KeyboardShortcuts />
                </ProtectedRoute>
              }
            />
            <Route
              path="/support"
              element={
                <ProtectedRoute>
                  <Support />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/finetune"
              element={
                <ProtectedRoute>
                  <AdminFineTune />
                </ProtectedRoute>
              }
            />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Summaries />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
            </SnapshotProvider>
            {/* Must stay INSIDE BrowserRouter — CookieConsent renders a <Link>,
                which throws without router context and blanks the whole app. */}
            <CookieConsent />
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
