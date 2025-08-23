import React from "react";
import { FileUpload } from "@/components/FileUpload";
import { getSelectedFile, setSelectedFile } from "@/lib/files";

export default function DataSourcesPage() {
  const [file, setFile] = React.useState<File | null>(getSelectedFile());

  return (
    <div className="p-6">
      <div className="pipeline-panel p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/20" />
          <h2 className="text-xl font-bold">Data Sources</h2>
        </div>

        <p className="text-sm text-muted-foreground mb-6">
          Add CSV/Excel/Text files. When you select a file, we’ll make it available to the Pipeline Editor.
        </p>

        <FileUpload
          selectedFile={file}
          onFileSelected={(f) => {
            setFile(f);
            setSelectedFile(f);
          }}
        />

        {file && (
          <p className="mt-3 text-xs text-muted-foreground">
            Selected: <span className="font-medium">{file.name}</span>
          </p>
        )}

        {/* Future: DB connectors & buttons can go here */}
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <button className="pipeline-button-secondary">Connect PostgreSQL</button>
          <button className="pipeline-button-secondary">Connect MySQL</button>
          <button className="pipeline-button-secondary">Connect BigQuery</button>
        </div>
      </div>
    </div>
  );
}
