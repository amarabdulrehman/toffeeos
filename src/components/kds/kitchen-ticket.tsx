interface TicketLine {
  id: string;
  nameSnapshot: string;
  quantity: number;
  notes: string | null;
  /** What was added to this line. The kitchen has to see these or it makes the wrong thing. */
  modifiers?: { id: string; nameSnapshot: string }[];
  isVoided?: boolean;
  /** Which send to the kitchen the line came in (OrderLine.kitchenRound); 1 when absent. */
  kitchenRound?: number;
}

interface TicketOrder {
  orderNumber: number;
  type: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "SERVICE";
  source: "POS" | "ONLINE" | "QR";
  sentToKitchenAt: string | null;
  table: { label: string } | null;
  lines: TicketLine[];
}

/** Pure, print-focused kitchen ticket — narrow (thermal-paper proportions), no prices (the kitchen
 * doesn't need money info, unlike the customer receipt this mirrors), just what to make and for
 * whom. The `print-area` class is what printTicket (src/lib/print-ticket.ts) looks for: it prints
 * this element alone, on a page exactly its length. `data-paper="kitchen"` sends it to the kitchen
 * printer's paper width rather than the receipt printer's, which is often a different roll. */
export function KitchenTicket({
  order,
  branchName,
  onlyRound,
}: {
  order: TicketOrder;
  branchName: string;
  /** Print only the lines added in this round, as an add-on ticket: items added to an order that
   * is already with the kitchen, so the first round isn't made twice. */
  onlyRound?: number;
}) {
  const lines = order.lines.filter((l) => !l.isVoided && (onlyRound == null || (l.kitchenRound ?? 1) === onlyRound));
  return (
    <div id="printable-kot" data-paper="kitchen" className="print-area mx-auto w-[300px] font-mono text-[15px] leading-snug text-black">
      <div className="text-center">
        <div className="text-lg font-bold">{onlyRound != null ? "ADD-ON TICKET" : "KITCHEN TICKET"}</div>
        <div>{branchName}</div>
      </div>
      <div className="my-2 border-t-2 border-dashed border-black" />
      <div className="flex justify-between text-xl font-bold">
        <span>#{order.orderNumber}</span>
        <span>{order.sentToKitchenAt ? new Date(order.sentToKitchenAt).toLocaleTimeString() : ""}</span>
      </div>
      <div className="font-bold">
        {order.type.replace(/_/g, " ")}
        {order.table ? ` · Table ${order.table.label}` : ""}
        {order.source !== "POS" ? ` · ${order.source}` : ""}
      </div>
      {onlyRound != null && (
        <div className="mt-1 border-2 border-black text-center font-bold">
          ADDED ITEMS ONLY
          <div className="text-sm font-normal">The rest of #{order.orderNumber} has already gone</div>
        </div>
      )}
      <div className="my-2 border-t-2 border-dashed border-black" />
      <div className="space-y-1.5">
        {/* What to make: a voided item is struck through on the kitchen screen, and left off paper. */}
        {lines.map((l) => (
          <div key={l.id}>
            <div className="font-bold">
              {l.quantity}× {l.nameSnapshot}
            </div>
            {/* Add-ons before the note: they change what is made, where a note usually qualifies
                it. Both were being sent to this component and only the note was ever printed, so a
                latte ordered with an extra shot reached the barista as a plain latte. */}
            {l.modifiers?.map((m) => (
              <div key={m.id} className="pl-4 text-sm font-bold">
                + {m.nameSnapshot}
              </div>
            ))}
            {l.notes && <div className="pl-4 text-sm italic">— {l.notes}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
