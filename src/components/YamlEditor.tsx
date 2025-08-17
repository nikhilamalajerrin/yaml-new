import React from "react";
import Editor from "@monaco-editor/react";
import { Play, Database } from "lucide-react";

interface YamlEditorProps {
  yamlText: string;
  onYamlChange: (value: string) => void;
  onRunPipeline: () => void;
}

export function YamlEditor({ yamlText, onYamlChange, onRunPipeline }: YamlEditorProps) {
  return (
    <div className="pipeline-panel flex flex-col">
      <div className="flex items-center justify-between p-6 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/20">
            <Database className="w-5 h-5 text-primary" />
          </div>
          <h2 className="text-xl font-bold">YAML Configuration</h2>
        </div>
        <button
          className="pipeline-button flex items-center gap-2"
          onClick={onRunPipeline}
        >
          <Play className="w-4 h-4" />
          Run Pipeline
        </button>
      </div>
      <div className="flex-1 p-6">
        <Editor
          height="100%"
          defaultLanguage="yaml"
          value={yamlText}
          onChange={(val) => onYamlChange(val || "nodes: {}")}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineHeight: 1.6,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  );
}