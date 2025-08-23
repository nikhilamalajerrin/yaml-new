// import React from "react";
// import Editor from "@monaco-editor/react";
// import { Play, Database } from "lucide-react";

// interface YamlEditorProps {
//   yamlText: string;
//   onYamlChange: (value: string) => void;
//   onRunPipeline: () => void;
// }

// export function YamlEditor({ yamlText, onYamlChange, onRunPipeline }: YamlEditorProps) {
//   return (
//     <div className="pipeline-panel flex flex-col">
//       <div className="flex items-center justify-between p-6 border-b border-border/50">
//         <div className="flex items-center gap-3">
//           <div className="p-2 rounded-lg bg-primary/20">
//             <Database className="w-5 h-5 text-primary" />
//           </div>
//           <h2 className="text-xl font-bold">YAML Configuration</h2>
//         </div>
//         <button
//           className="pipeline-button flex items-center gap-2"
//           onClick={onRunPipeline}
//         >
//           <Play className="w-4 h-4" />
//           Run Pipeline
//         </button>
//       </div>
//       <div className="flex-1 p-6">
//         <Editor
//           height="100%"
//           defaultLanguage="yaml"
//           value={yamlText}
//           onChange={(val) => onYamlChange(val || "nodes: {}")}
//           theme="vs-dark"
//           options={{
//             minimap: { enabled: false },
//             fontSize: 14,
//             lineHeight: 1.6,
//             fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
//             scrollBeyondLastLine: false,
//           }}
//         />
//       </div>
//     </div>
//   );
// }

// src/components/YamlEditor.tsx
import React from "react";
import Editor, { type BeforeMount } from "@monaco-editor/react";
import { Play, Database } from "lucide-react";

interface YamlEditorProps {
  yamlText: string;
  onYamlChange: (value: string) => void;
  onRunPipeline: () => void;
}

const beforeMount: BeforeMount = (monaco) => {
  monaco.editor.defineTheme("tharavu-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      // keep the editor fully transparent so it blends with the panel
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
        <button className="pipeline-button flex items-center gap-2" onClick={onRunPipeline}>
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

