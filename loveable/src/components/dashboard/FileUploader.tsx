
import React, { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Upload, File, X, CheckCircle, FileText, AlertCircle } from "lucide-react";

interface FileUploaderProps {
  onFileUpload?: (file: File) => void;
  /** Called when the last selected file is removed, so the parent can clear its state. */
  onFileRemoved?: () => void;
  initialFile?: File;
  disabled?: boolean;
  acceptExtensions?: string[];
  helperText?: string;
}

const FileUploader: React.FC<FileUploaderProps> = ({
  onFileUpload,
  onFileRemoved,
  initialFile,
  disabled = false,
  acceptExtensions = [".pdf", ".doc", ".docx", ".txt"],
  helperText,
}) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>(
    initialFile ? [initialFile] : []
  );
  const [isDragging, setIsDragging] = useState(false);
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptAttr = acceptExtensions.join(",");

  useEffect(() => {
    if (initialFile) {
      setSelectedFiles([initialFile]);
    }
  }, [initialFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      const newFile = filesArray[0];
      
      // Validate file type
      const fileExtension = '.' + newFile.name.split('.').pop()?.toLowerCase();
      
      if (!acceptExtensions.includes(fileExtension)) {
        toast({
          title: "Invalid file type",
          description: `Allowed types: ${acceptExtensions.join(", ")}`,
          variant: "destructive",
        });
        return;
      }

      setSelectedFiles([newFile]);
      onFileUpload?.(newFile);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled) {
      setIsDragging(true);
    }
  };
  
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };
  
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (disabled) return;
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesArray = Array.from(e.dataTransfer.files);
      const newFile = filesArray[0];
      
      // Validate file type
      const fileExtension = '.' + newFile.name.split('.').pop()?.toLowerCase();
      
      if (!acceptExtensions.includes(fileExtension)) {
        toast({
          title: "Invalid file type",
          description: `Allowed types: ${acceptExtensions.join(", ")}`,
          variant: "destructive",
        });
        return;
      }

      setSelectedFiles([newFile]);

      if (onFileUpload) {
        onFileUpload(newFile);
      }
    }
  };

  const removeFile = (index: number) => {
    if (disabled) return;
    
    const newFiles = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(newFiles);

    // When the last file is removed, notify the parent so it can clear its stale reference.
    if (newFiles.length === 0) {
      onFileRemoved?.();
    }
  };

  const getFileIcon = (fileName: string) => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    switch (extension) {
      case 'pdf':
        return <FileText className="w-5 h-5 text-red-500" />;
      case 'doc':
      case 'docx':
        return <FileText className="w-5 h-5 text-blue-600" />;
      case 'txt':
        return <File className="w-5 h-5 text-gray-600" />;
      default:
        return <File className="w-5 h-5 text-gray-500" />;
    }
  };

  const handleClick = () => {
    if (!disabled && inputRef.current) {
      inputRef.current.click();
    }
  };

  return (
    <div className="w-full mt-4">
      <div
        className={`relative border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all duration-200 ${
          disabled 
            ? "cursor-not-allowed opacity-50" 
            : "cursor-pointer"
        } ${
          isDragging && !disabled
            ? "border-[#5674BC] bg-blue-50 scale-105" 
            : "border-gray-300 hover:border-[#5674BC] hover:bg-blue-50/50"
        } bg-white/60 backdrop-blur-sm`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        {/* Upload Icon with Animation */}
        <div className={`p-4 rounded-full bg-gradient-to-br from-[#5674BC] to-[#4a65a7] mb-4 transition-transform ${isDragging && !disabled ? 'scale-110' : ''}`}>
          <Upload className="w-8 h-8 text-white" />
        </div>
        
        <h3 className="text-lg font-semibold text-slate-800 mb-2">
          Drop your files here
        </h3>
        <p className="text-gray-600 text-center mb-4">
          Drag & drop your deposition files, or{" "}
          <span className="text-[#5674BC] font-medium">browse</span> to upload
        </p>
        
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <div className="flex items-center gap-1">
            <CheckCircle className="w-4 h-4 text-green-500" />
            {helperText ?? acceptExtensions.join(", ").toUpperCase()}
          </div>
          <div className="flex items-center gap-1">
            <CheckCircle className="w-4 h-4 text-green-500" />
            Secure Upload
          </div>
        </div>
        
        <input
          ref={inputRef}
          type="file"
          accept={acceptAttr}
          className="hidden"
          onChange={handleFileChange}
          disabled={disabled}
        />
      </div>

      {selectedFiles.length > 0 && (
        <div className="mt-6 space-y-3">
          <h4 className="font-medium text-slate-800 flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#5674BC]" />
            Uploaded Files ({selectedFiles.length})
          </h4>
          {selectedFiles.map((file, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-4 bg-white/80 backdrop-blur-sm rounded-lg border border-gray-200 shadow-sm transition-all hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                {getFileIcon(file.name)}
                <div>
                  <p className="font-medium text-slate-800 truncate max-w-[300px]">
                    {file.name}
                  </p>
                  <p className="text-sm text-gray-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              </div>
              {!disabled && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(idx);
                  }}
                  className="p-1 hover:bg-red-50 rounded-full transition-colors group"
                >
                  <X className="w-4 h-4 text-gray-500 group-hover:text-red-500" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FileUploader;
