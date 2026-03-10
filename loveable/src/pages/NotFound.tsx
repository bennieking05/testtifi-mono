
import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { FileX } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900">
      <div className="text-center p-8 max-w-md bg-white dark:bg-slate-800 rounded-lg shadow-md border border-gray-200 dark:border-slate-700">
        <div className="flex justify-center mb-6">
          <FileX className="h-24 w-24 text-[#5674BC] dark:text-blue-400" />
        </div>
        <h1 className="text-4xl font-bold mb-4 text-[#5674BC] dark:text-blue-400">404</h1>
        <p className="text-xl text-gray-600 dark:text-slate-300 mb-6">The page you're looking for doesn't exist</p>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
          You might have mistyped the address or the page may have been moved.
        </p>
        <Button asChild className="bg-[#5674BC] hover:bg-[#4a65a7] text-white">
          <Link to="/">Return to Home</Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
