import React from "react";
import { Upload, FileText } from "lucide-react";

interface FileUploadProps {
  onFileSelected: (file: File) => void;
  selectedFile?: File | null;
}

export function FileUpload({ onFileSelected, selectedFile }: FileUploadProps) {
  return (
    <div className="pipeline-file-upload group">
      <input
        type="file"
        className="pipeline-file-input"
        accept=".csv,.xlsx,.txt"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
        }}
      />
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="p-3 rounded-full bg-primary/20 group-hover:bg-primary/30 transition-colors duration-300">
          <Upload className="w-6 h-6 text-primary" />
        </div>
        <div>
          {selectedFile ? (
            <div className="flex items-center gap-2 text-secondary">
              <FileText className="w-4 h-4" />
              <span className="font-medium">{selectedFile.name}</span>
            </div>
          ) : (
            <div>
              <p className="font-medium text-foreground">Upload Data File</p>
              <p className="text-sm text-muted-foreground">CSV, Excel, or Text files</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}