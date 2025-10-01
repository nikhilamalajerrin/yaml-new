import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import yaml from "yaml";

type Props = {
  open: boolean;
  onClose: () => void;
  yamlText: string;
  order: string[];
  index: number;
  onIndexChange: (i: number) => void;
  onEditNode: (id: string) => void;
};

export function StepReviewModal({
  open, onClose, yamlText, order, index, onIndexChange, onEditNode,
}: Props) {
  const spec = React.useMemo(() => {
    try { return yaml.parse(yamlText) || { nodes: {} }; }
    catch { return { nodes: {} as any }; }
  }, [yamlText]);

  const id = order[index];
  const entry = spec?.nodes?.[id];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-full max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Review {id ? `"${id}"` : ""} ({index + 1} / {order.length})
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-md border border-border/50 bg-neutral-900 p-3">
          <pre className="whitespace-pre-wrap text-sm">
{yaml.stringify({ [id || ""]: entry || {} })}
          </pre>
        </div>

        <div className="mt-4 flex justify-between">
          <div className="flex gap-2">
            <Button variant="outline" disabled={index <= 0} onClick={() => onIndexChange(index - 1)}>
              Back
            </Button>
            <Button variant="secondary" onClick={() => onEditNode(id)}>
              Edit
            </Button>
          </div>
          <div className="flex gap-2">
            {index < order.length - 1 ? (
              <Button onClick={() => onIndexChange(index + 1)}>OK → Next</Button>
            ) : (
              <Button onClick={onClose}>Done</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
