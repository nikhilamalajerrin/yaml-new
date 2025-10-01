import React, { useEffect, useMemo, useRef } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

/**
 * Lightweight wrapper around React Flow:
 * - smoothstep edges with arrowheads
 * - auto fitView when nodes/edges change
 * - dark minimap
 * - pan/zoom enabled; nodes are selectable & deletable from parent via onNodesChange
 */

type Props = {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onNodeDoubleClick?: (evt: React.MouseEvent, node: Node) => void;
};

export function PipelineFlow({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onNodeDoubleClick,
}: Props) {
  const rf = useReactFlow();
  const firstFitRef = useRef(false);

  // decorate edges with markers & defaults
  const decoratedEdges = useMemo<Edge[]>(
    () =>
      (edges || []).map((e) => ({
        type: "smoothstep",
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { strokeWidth: 3 },
        ...e,
      })),
    [edges]
  );

  // initial & subsequent fit
  useEffect(() => {
    const hasGraph = (nodes?.length || 0) > 0;
    if (!hasGraph) return;
    const timeout = setTimeout(() => {
      if (!firstFitRef.current) {
        firstFitRef.current = true;
        try {
          rf.fitView({ padding: 0.2, includeHiddenNodes: true, duration: 300 });
        } catch {}
      } else {
        try {
          rf.fitView({ padding: 0.2, includeHiddenNodes: true, duration: 200 });
        } catch {}
      }
    }, 0);
    return () => clearTimeout(timeout);
  }, [nodes?.length, decoratedEdges?.length, rf]);

  return (
    <div className="h-full w-full rounded-xl border border-border/50 overflow-hidden bg-background">
      <ReactFlow
        nodes={nodes}
        edges={decoratedEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDoubleClick={onNodeDoubleClick}
        fitView
        nodesDraggable
        nodesConnectable={false} // we infer edges from YAML/params; no manual dragging of handles
        panOnScroll
        zoomOnScroll
        panOnDrag
        deleteKeyCode="Backspace"
        selectionKeyCode="Shift"
      >
        <Background />
        <MiniMap
          pannable
          zoomable
          style={{ background: "transparent" }}
          nodeStrokeColor="hsl(var(--primary))"
          nodeColor="hsl(var(--card))"
          maskColor="rgba(0,0,0,0.35)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export default PipelineFlow;
