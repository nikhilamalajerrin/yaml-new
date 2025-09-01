// src/components/YamlEditor.tsx
import React from "react";
import Editor, { type BeforeMount } from "@monaco-editor/react";
import { Play, Database, Save, Loader2 } from "lucide-react";

interface YamlEditorProps {
  yamlText: string;
  onYamlChange: (value: string) => void;
  onRunPipeline: () => void;

  // NEW: pipeline naming + save
  name: string;
  onNameChange: (value: string) => void;
  onSave: () => void;
  saving?: boolean;
}

const beforeMount: BeforeMount = (monaco) => {
  monaco.editor.defineTheme("tharavu-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      // make the editor background transparent to blend with the panel
      "editor.background": "#00000000",
      "editorGutter.background": "#00000000",

      // remove default blue focus borders/glow
      "focusBorder": "#00000000",
      "editor.focusedStackFrameHighlightBorder": "#00000000",
      "editor.stackFrameHighlightBorder": "#00000000",
      "editorOverviewRuler.border": "#00000000",
      "panel.border": "#1b2333",

      // subtle bluish accent palette to match the right canvas
      "editorCursor.foreground": "#93c5fd",
      "editorLineNumber.foreground": "#94a3b8",
      "editorLineNumber.activeForeground": "#cbd5e1",
      "editor.selectionBackground": "hsla(217, 91%, 60%, 0.28)",
      "editor.inactiveSelectionBackground": "hsla(217, 91%, 60%, 0.16)",
      "editor.lineHighlightBackground": "#ffffff0a",
      "editorIndentGuide.background": "#33415566",
      "editorIndentGuide.activeBackground": "#93c5fd55",
      "editorRuler.foreground": "#33415566",

      // widgets / suggest
      "editorWidget.background": "#0b1220f2",
      "editorSuggestWidget.background": "#0b1220f2",
      "editorSuggestWidget.border": "#1f2a44",
      "editorSuggestWidget.selectedBackground": "#1f2a44",

      // scrollbars
      "scrollbarSlider.background": "#64748b33",
      "scrollbarSlider.hoverBackground": "#64748b55",
      "scrollbarSlider.activeBackground": "#64748b77",
    },
  });
};

export function YamlEditor({
  yamlText,
  onYamlChange,
  onRunPipeline,
  name,
  onNameChange,
  onSave,
  saving = false,
}: YamlEditorProps) {
  return (
    <div className="pipeline-panel flex flex-col">
      {/* Header */}
      <div className="p-4 sm:p-6 border-b border-border/50">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {/* Left: title (small, non-overlapping icon) */}
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-primary/15">
              <Database className="w-4 h-4 text-primary" />
            </div>
            <h2 className="text-lg sm:text-xl font-semibold">YAML Configuration</h2>
          </div>

          {/* Middle: pipeline name input (grows; wraps on small screens) */}
          <div className="flex-1 md:max-w-[48%]">
            <input
              className="pipeline-input w-full"
              placeholder="Untitled pipeline"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              title="Pipeline name"
            />
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-2">
            <button
              className="pipeline-button-secondary flex items-center gap-2 disabled:opacity-60"
              onClick={onSave}
              disabled={saving || !name.trim()}
              title={name.trim() ? "Save pipeline" : "Enter a name to save"}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>Save</span>
            </button>

            <button
              className="pipeline-button flex items-center gap-2"
              onClick={onRunPipeline}
              title="Run Pipeline"
            >
              <Play className="w-4 h-4" />
              <span>Run</span>
            </button>
          </div>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 p-4 sm:p-6">
        <Editor
          height="100%"
          defaultLanguage="yaml"
          value={yamlText}
          onChange={(val) => onYamlChange(val || "nodes: {}")}
          beforeMount={beforeMount}
          theme="tharavu-dark"
          options={{
            minimap: { enabled: false },
            automaticLayout: true,
            fontSize: 14,
            lineHeight: 1.6,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            renderWhitespace: "selection",
            padding: { top: 12, bottom: 12 },
            roundedSelection: false,
            renderLineHighlight: "line",
          }}
        />
      </div>
    </div>
  );
}
