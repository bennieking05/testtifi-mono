import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import api from "@/lib/axios";

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { token } = useParams<{ token: string }>(); // Extract token from the URL
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Please make sure your passwords match",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      // Use the shared axios client so the request goes to the backend (VITE_API_URL).
      // A relative "/api/..." URL here hit the frontend host (nginx) and returned 405.
      await api.post("/api/auth/reset-password", { token, newPassword: password });

      toast({
        title: "Password reset successful",
        description:
          "Your password has been reset. You can now log in with your new password.",
      });

      navigate("/login");
    } catch (error: any) {
      toast({
        title: "Error",
        description:
          error?.response?.data?.error ||
          error?.message ||
          "An error occurred. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-lg border border-[rgba(86,116,188,0.2)] max-w-md w-full">
          <h1 className="text-2xl font-bold mb-4 text-center text-[#5674BC]">
            Invalid Reset Link
          </h1>
          <p className="text-gray-600 mb-6 text-center">
            This password reset link is invalid or has expired. Please request a
            new password reset link.
          </p>
          <Button
            className="w-full bg-[#5674BC] hover:bg-[#4a65a7] text-white"
            onClick={() => navigate("/forgot-password")}
          >
            Request New Link
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row relative bg-white dark:bg-slate-900">
      {/* Left side - Form */}
      <div className="flex-1 flex flex-col justify-center items-center p-8 md:p-16 z-10">
        <div className="w-full max-w-md">
          <img
            src={`${import.meta.env.BASE_URL}testifi_light_logo.png`}
            alt="Testifi AI Logo"
            className="w-[281px] h-auto object-contain mx-auto mb-8 dark:hidden"
          />
          <img
            src={`${import.meta.env.BASE_URL}testifi_dark_logo.png`}
            alt="Testifi AI Logo"
            className="w-[281px] h-auto object-contain mx-auto mb-8 hidden dark:block"
          />
          <div className="bg-white dark:bg-slate-800 p-8 rounded-lg shadow-lg border border-[rgba(86,116,188,0.2)] dark:border-slate-700">
            <h1 className="text-2xl font-bold mb-6 text-center text-[#5674BC] dark:text-blue-400">
              Set New Password
            </h1>
            <p className="text-gray-600 dark:text-slate-300 mb-6 text-center">
              Enter your new password below.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium mb-1 text-slate-900 dark:text-slate-100"
                >
                  New Password
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 border-gray-300 dark:border-slate-600"
                  required
                  minLength={8}
                />
              </div>
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium mb-1 text-slate-900 dark:text-slate-100"
                >
                  Confirm New Password
                </label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="w-full bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 border-gray-300 dark:border-slate-600"
                  required
                  minLength={8}
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-[#5674BC] hover:bg-[#4a65a7] dark:bg-blue-600 dark:hover:bg-blue-700 text-white"
                disabled={isLoading}
              >
                {isLoading ? "Resetting Password..." : "Reset Password"}
              </Button>
            </form>
            <div className="mt-6 text-center">
              <p className="text-sm text-slate-900 dark:text-slate-100">
                Remember your password?{" "}
                <a
                  href="/login"
                  className="text-[#5674BC] dark:text-blue-400 hover:underline"
                >
                  Sign in
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
      {/* Right side - Background design */}
      <div className="hidden md:flex md:flex-1 relative bg-[#5674BC] dark:bg-slate-800">
        <div className="absolute inset-0 opacity-20">
          <svg width="100%" height="100%" viewBox="0 0 800 800">
            <defs>
              <pattern
                id="smallGrid"
                width="20"
                height="20"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 20 0 L 0 0 0 20"
                  fill="none"
                  stroke="white"
                  strokeWidth="0.5"
                />
              </pattern>
              <pattern
                id="grid"
                width="80"
                height="80"
                patternUnits="userSpaceOnUse"
              >
                <rect width="80" height="80" fill="url(#smallGrid)" />
                <path
                  d="M 80 0 L 0 0 0 80"
                  fill="none"
                  stroke="white"
                  strokeWidth="1"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>
        <div className="relative z-10 flex flex-col items-center justify-center w-full p-12 text-white">
          <svg
            width="180"
            height="180"
            viewBox="0 0 180 180"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="mb-8"
          >
            <g clipPath="url(#clip0_31_1097)">
              <path
                d="M178.519 22.718C178.412 22.6174 157.268 2.45354 157.268 2.45354C156.46 1.678 155.624 0.876434 154.063 0.876434H68.9429C66.4566 0.876434 64.4338 2.89897 64.4338 5.38522V19.2308L34.4332 24.3735C32.0285 24.7953 30.4113 27.0967 30.8279 29.4989L32.3505 38.3766C22.5992 41.658 12.5878 45.0408 2.92297 48.5125C0.639222 49.3474 -0.559255 51.8867 0.255667 54.1842L19.4809 107.627C19.8676 108.703 20.8811 109.372 21.9622 109.372C22.2582 109.372 22.5598 109.322 22.8545 109.216C24.2248 108.723 24.9361 107.213 24.4432 105.842L5.50239 53.1896C14.6079 49.9296 24.0375 46.7388 33.253 43.637L42.3131 96.4575L52.7383 157.289C53.1149 159.436 55.0024 160.964 57.1329 160.964C57.374 160.964 57.6187 160.945 57.8641 160.904L86.1002 156.059L108.164 152.276L74.9799 164.204L48.8114 173.613L28.4882 117.085C27.9957 115.715 26.4857 115.004 25.115 115.496C23.7446 115.989 23.0334 117.499 23.5259 118.87L44.1373 176.2C44.7965 178.003 46.5044 179.124 48.3097 179.124C48.8086 179.124 49.3152 179.038 49.8088 178.858L76.7634 169.167L137.968 147.168L149.661 145.164H175.491C177.977 145.164 180 143.137 180 140.645V25.689C180 24.1108 179.144 23.3058 178.519 22.718Z"
                fill="white"
              />
              <path
                d="M82.417 41.818C82.417 43.2742 83.5975 44.4547 85.0537 44.4547H160.441C161.898 44.4547 163.078 43.2742 163.078 41.818C163.078 40.3618 161.898 39.1813 160.441 39.1813H85.0537C83.5975 39.1813 82.417 40.3618 82.417 41.818Z"
                fill="white"
              />
              <path
                d="M160.441 57.9132H85.0537C83.5975 57.9132 82.417 59.0938 82.417 60.55C82.417 62.0061 83.5975 63.1867 85.0537 63.1867H160.441C161.898 63.1867 163.078 62.0061 163.078 60.55C163.078 59.0938 161.898 57.9132 160.441 57.9132Z"
                fill="white"
              />
              <path
                d="M160.441 76.6452H85.0537C83.5975 76.6452 82.417 77.8257 82.417 79.2819C82.417 80.7381 83.5975 81.9186 85.0537 81.9186H160.441C161.898 81.9186 163.078 80.7381 163.078 79.2819C163.078 77.8257 161.898 76.6452 160.441 76.6452Z"
                fill="white"
              />
              <path
                d="M160.441 95.3771H85.0537C83.5975 95.3771 82.417 96.5577 82.417 98.0139C82.417 99.47 83.5975 100.651 85.0537 100.651H160.441C161.898 100.651 163.078 99.47 163.078 98.0139C163.078 96.5577 161.898 95.3771 160.441 95.3771Z"
                fill="white"
              />
              <path
                d="M160.441 114.109H85.0537C83.5975 114.109 82.417 115.29 82.417 116.746C82.417 118.202 83.5975 119.383 85.0537 119.383H160.441C161.898 119.383 163.078 118.202 163.078 116.746C163.078 115.29 161.898 114.109 160.441 114.109Z"
                fill="white"
              />
            </g>
          </svg>
        </div>
      </div>
      <div className="absolute inset-0 bg-[#5674BC] opacity-5 pattern-grid-white/[0.2] md:hidden dark:bg-slate-800"></div>
    </div>
  );
};

export default ResetPassword;
