import React, { useMemo } from "react";
import { X, Table as TableIcon } from "lucide-react";

interface TableModalProps {
  open: boolean;
  onClose: () => void;
  table: {
    columns?: string[];
    data?: any[][];
  } | null;
}

function isNumberLike(v: any) {
  if (v === null || v === undefined) return false;
  if (typeof v === "number") return true;
  if (typeof v !== "string") return false;
  // allow "12,345.67" or "1 234" etc. – keep simple & permissive
  const s = v.replace(/[, ]/g, "");
  return s !== "" && !isNaN(Number(s));
}

function cellDisplay(v: any) {
  if (v === null || v === undefined) return <span className="text-muted-foreground italic">null</span>;
  const s = String(v);
  return s;
}

export function TableModal({ open, onClose, table }: TableModalProps) {
  if (!open) return null;

  // derive a key so the modal re-mounts when dataset changes
  const remountKey = useMemo(() => {
    const cols = table?.columns?.length ?? 0;
    const rows = table?.data?.length ?? 0;
    return `t:${cols}x${rows}`;
  }, [table?.columns, table?.data]);

  // Prepare data
  const columns: string[] = useMemo(() => {
    if (table?.columns && table.columns.length) return table.columns;
    // if no columns passed, infer based on first row
    const first = table?.data?.[0] ?? [];
    return Array.from({ length: first.length }, (_, i) => `col_${i + 1}`);
  }, [table?.columns, table?.data]);

  const totalRows = table?.data?.length ?? 0;
  const previewRows = Math.min(totalRows, 200);
  const rows = (table?.data ?? []).slice(0, previewRows);

  return (
    <div className="pipeline-modal" key={remountKey}>
      <div className="pipeline-modal-content max-w-6xl w-full p-0 animate-slide-up overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-secondary/20">
                <TableIcon className="w-5 h-5 text-secondary" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-foreground">Data Preview</h3>
                <p className="text-sm text-muted-foreground">
                  {totalRows} {totalRows === 1 ? "row" : "rows"}, {columns.length} {columns.length === 1 ? "column" : "columns"}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-muted/50 transition-colors duration-200"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Table area */}
        <div className="max-h-[60vh] overflow-auto">
          {columns.length ? (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-card">
                  {columns.map((col, i) => (
                    <th
                      key={i}
                      className="px-4 py-3 text-left font-semibold whitespace-nowrap border-b border-border/60"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr
                    key={r}
                    className="border-b border-border/30 hover:bg-muted/30 transition-colors duration-150"
                  >
                    {columns.map((_, c) => {
                      const v = row?.[c];
                      const right = isNumberLike(v);
                      return (
                        <td
                          key={c}
                          className={`px-4 py-2 whitespace-nowrap ${right ? "text-right tabular-nums" : "text-left"} max-w-[24rem]`}
                          title={v === null || v === undefined ? "null" : String(v)}
                        >
                          <div className="truncate">{cellDisplay(v)}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-12">
              <div className="p-4 rounded-full bg-muted/20 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                <TableIcon className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground">No data to display</p>
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="px-6 py-3 border-t border-border/50 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          {totalRows > previewRows ? (
            <p className="text-xs text-muted-foreground">
              Showing first {previewRows.toLocaleString()} rows of{" "}
              {totalRows.toLocaleString()} total rows
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">End of data</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default TableModal;
