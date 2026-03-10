
import React from "react";
import { FileText, Zap, ArrowRight } from "lucide-react";

interface SummaryTypeProps {
  title: string;
  description: string;
  iconSrc: string;
}

const SummaryType: React.FC<SummaryTypeProps> = ({ title, description }) => {
  return (
    <div className="group relative flex flex-col justify-center items-center p-8 border-2 border-gray-200 hover:border-[#5674BC] rounded-2xl w-full max-w-sm bg-white/80 backdrop-blur-sm hover:shadow-xl transition-all duration-300 cursor-pointer">
      {/* Gradient overlay on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#5674BC]/5 to-[#4a65a7]/5 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      
      {/* Icon with enhanced styling */}
      <div className="relative p-4 bg-gradient-to-br from-[#5674BC] to-[#4a65a7] rounded-2xl mb-6 group-hover:scale-110 transition-transform duration-300 shadow-lg">
        <FileText className="w-8 h-8 text-white" />
        <div className="absolute -top-1 -right-1 p-1 bg-yellow-400 rounded-full">
          <Zap className="w-3 h-3 text-yellow-800" />
        </div>
      </div>
      
      <div className="relative z-10 text-center pr-14">
        <h3 className="text-xl font-bold text-slate-800 mb-3 group-hover:text-[#5674BC] transition-colors">
          {title}
        </h3>
        <p className="text-gray-600 text-sm leading-relaxed mb-4">
          {description}
        </p>
        
        {/* Call to action */}
        <div className="flex items-center justify-center gap-2 text-[#5674BC] font-medium text-sm opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0">
          <span>Get Started</span>
          <ArrowRight className="w-4 h-4" />
        </div>
      </div>
      
      {/* Professional badge */}
      <div className="absolute top-4 right-4 px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
        AI Powered
      </div>
    </div>
  );
};

export default SummaryType;
