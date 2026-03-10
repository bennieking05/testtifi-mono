import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/axios"; // ✅ Correct import
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await api.post("/api/auth/login", { email, password });
      const { accessToken, refreshToken, credits, name, role } = response.data;

      localStorage.setItem("token", accessToken);
      localStorage.setItem("refreshToken", refreshToken);
      localStorage.setItem("credits", credits.toString());
      localStorage.setItem("role", role);
      localStorage.setItem("name", name ?? "User");

      toast({
        title: "Login successful",
        description: `Welcome back, ${
          name || "User"
        }! You have ${credits} credits.`,
      });

      navigate("/dashboard");
    } catch (error: any) {
      console.error("Login error:", error);
      toast({
        title: "Login failed",
        description: error.response?.data?.error || "Invalid email or password",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row relative bg-white dark:bg-slate-900">
      {/* Left side - Form */}
      <div className="flex-1 flex flex-col justify-center items-center p-8 md:p-16 z-10">
        <div className="w-full max-w-md">
          {/* light mode logo */}
          <img
            src={`${import.meta.env.BASE_URL}testifi_light_logo.png`}
            alt="Testifi AI Logo"
            className="w-[281px] h-auto object-contain mx-auto mb-8 dark:hidden"
          />
          {/* dark mode logo */}
          <img
            src={`${import.meta.env.BASE_URL}testifi_dark_logo.png`}
            alt="Testifi AI Logo"
            className="w-[281px] h-auto object-contain mx-auto mb-8 hidden dark:block"
          />

          <div className="bg-white dark:bg-slate-800 p-8 rounded-lg shadow-lg border border-[rgba(86,116,188,0.2)] dark:border-slate-700">
            <h1 className="text-2xl font-bold mb-6 text-center text-[#5674BC] dark:text-blue-400">
              Welcome Back
            </h1>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium mb-1 text-slate-900 dark:text-slate-100"
                >
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 border-gray-300 dark:border-slate-600"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium mb-1 text-slate-900 dark:text-slate-100"
                >
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 border-gray-300 dark:border-slate-600"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <input
                    id="remember"
                    type="checkbox"
                    className="h-4 w-4 text-[#5674BC] border-gray-300 dark:border-slate-600 rounded"
                  />
                  <label
                    htmlFor="remember"
                    className="ml-2 block text-sm text-slate-900 dark:text-slate-100"
                  >
                    Remember me
                  </label>
                </div>
                <a
                  href="/forgot-password"
                  className="text-sm text-[#5674BC] dark:text-blue-400 hover:underline"
                >
                  Forgot password?
                </a>
              </div>

              <Button
                type="submit"
                className="w-full bg-[#5674BC] hover:bg-[#4a65a7] dark:bg-blue-600 dark:hover:bg-blue-700 text-white"
                disabled={isLoading}
              >
                {isLoading ? "Signing in..." : "Sign in"}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-slate-900 dark:text-slate-100">
                Don't have an account?{" "}
                <a
                  href="/register"
                  className="text-[#5674BC] dark:text-blue-400 hover:underline"
                >
                  Sign up
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Right side - SVG Design */}
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

        <div className="relative z-10 flex flex-col items-center justify-center w-full p-12 text-white text-center">
          <svg
            width="180"
            height="180"
            viewBox="0 0 180 180"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="mb-8"
          >
            <path
              d="M178.519 22.718C178.412 22.6174 157.268 2.45354 157.268 2.45354C156.46 1.678 155.624 0.876434 154.063 0.876434H68.9429C66.4566 0.876434 64.4338 2.89897 64.4338 5.38522V19.2308L34.4332 24.3735C32.0285 24.7953 30.4113 27.0967 30.8279 29.4989L32.3505 38.3766C22.5992 41.658 12.5878 45.0408 2.92297 48.5125C0.639222 49.3474 -0.559255 51.8867 0.255667 54.1842L19.4809 107.627C19.8676 108.703 20.8811 109.372 21.9622 109.372C22.2582 109.372 22.5598 109.322 22.8545 109.216C24.2248 108.723 24.9361 107.213 24.4432 105.842L5.50239 53.1896C14.6079 49.9296 24.0375 46.7388 33.253 43.637L42.3131 96.4575L52.7383 157.289C53.1149 159.436 55.0024 160.964 57.1329 160.964L137.968 147.168L149.661 145.164H175.491C177.977 145.164 180 143.137 180 140.645V25.689C180 24.1108 179.144 23.3058 178.519 22.718Z"
              fill="white"
            />
          </svg>

          <h2 className="text-3xl font-bold mb-4">
            Document Summary Made Easy
          </h2>
          <p className="max-w-md">
            Streamline your document review process with AI-powered summaries
            that extract key insights instantly.
          </p>
        </div>
      </div>

      {/* Mobile background overlay */}
      <div className="absolute inset-0 bg-[#5674BC] opacity-5 pattern-grid-white/[0.2] md:hidden dark:bg-slate-800"></div>
    </div>
  );
};

export default Login;
