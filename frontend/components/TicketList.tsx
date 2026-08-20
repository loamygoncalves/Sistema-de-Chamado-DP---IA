"use client";

import Link from "next/link";
import type { Ticket } from "@/lib/types";
import { StatusBadge, PriorityBadge } from "@/components/TicketStatusBadge";

export default function TicketList({ tickets, basePath = "/tickets" }: { tickets: Ticket[]; basePath?: string }) {
  if (tickets.length === 0) {
    return <p className="text-sm text-slate-400">Nenhum chamado encontrado.</p>;
  }

  return (
    <div className="divide-y divide-slate-100">
      {tickets.map((ticket) => (
        <Link
          key={ticket.id}
          href={`${basePath}/${ticket.id}`}
          className="flex items-center justify-between gap-4 py-3 hover:bg-slate-50"
        >
          <div>
            <p className="text-sm font-medium text-slate-800">
              {ticket.ticket_number} · {ticket.subject}
            </p>
            <p className="text-xs text-slate-500">
              {new Date(ticket.created_at).toLocaleString("pt-BR")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <PriorityBadge priority={ticket.priority} />
            <StatusBadge status={ticket.status} />
          </div>
        </Link>
      ))}
    </div>
  );
}
