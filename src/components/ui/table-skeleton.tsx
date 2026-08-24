import { TableCell, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder rows for any data table while its fetch is in flight — used across Reports, CRM,
 * HR, and elsewhere so a slow/cold request never reads as "no data" before it's actually resolved
 * (the exact bug class fixed piecemeal in earlier passes; this is the shared version). `widths`
 * lets each column's placeholder roughly match its real content's shape (e.g. a wide name column,
 * a narrow numeric one) instead of every cell being the same generic bar. */
export function TableSkeletonRows({
  rows = 5,
  widths,
  align,
}: {
  rows?: number;
  widths: string[];
  align?: ("left" | "right")[];
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i}>
          {widths.map((w, j) => (
            <TableCell key={j} className={align?.[j] === "right" ? "text-right" : undefined}>
              <Skeleton className={`h-4 ${w} ${align?.[j] === "right" ? "ml-auto" : ""}`} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
