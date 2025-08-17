import React from "react";
import {
  ReactFlow,
  Background,
  Controls,
  ConnectionLineType, // ✅ enum, not string
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Eye } from "lucide-react";

interface PipelineFlowProps {
  nodes: any[];
  edges: any[];
  onNodesChange: (changes: any) => void;
  onEdgesChange: (changes: any) => void;
  onNodeDoubleClick: (event: any, node: any) => void;
}

export function PipelineFlow({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onNodeDoubleClick,
}: PipelineFlowProps) {
  return (
    <div className="w-full h-full rounded-xl bg-background/50 border border-border/30 overflow-hidden relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDoubleClick={onNodeDoubleClick}
        fitView
        panOnScroll
        zoomOnScroll
        style={{ width: "100%", height: "100%" }}
        // nice default look for new edges
        defaultEdgeOptions={{
          type: "bezier",
          animated: true,
          style: { stroke: "hsl(var(--primary))", strokeWidth: 3 },
        }}
        // ❗ TS fix: use enum instead of "bezier"
        connectionLineType={ConnectionLineType.Bezier}
      >
        <Controls className="!bg-card !border-border/50" />
        <Background color="hsl(var(--border))" gap={20} size={1} className="opacity-30" />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="p-4 rounded-full bg-muted/20 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
              <Eye className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-lg font-medium">
              Start building your pipeline
            </p>
            <p className="text-muted-foreground text-sm">
              Add functions to create your data processing workflow
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default PipelineFlow;
