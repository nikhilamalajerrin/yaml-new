// src/components/NotebookPanel.tsx
import React, { useEffect, useRef } from "react";

type NotebookPanelProps = {
  bustKey?: string; // optional
};

export default function NotebookPanel({ bustKey }: NotebookPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!iframeRef.current) return;
    const base = "http://localhost:8888/lab"; // or from env/config
    const url = `${base}?bust=${bustKey ?? ""}`;
    // reload only when bustKey changes
    iframeRef.current.src = url;
  }, [bustKey]);

  return (
    <div className="h-full w-full rounded-lg overflow-hidden border">
      <iframe
        ref={iframeRef}
        title="Notebook"
        className="w-full h-full"
        src={`http://localhost:8888/lab${bustKey ? `?bust=${bustKey}` : ""}`}
      />
    </div>
  );
}
