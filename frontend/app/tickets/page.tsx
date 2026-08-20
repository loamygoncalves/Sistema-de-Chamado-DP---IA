"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Ticket } from "@/lib/types";
import TicketList from "@/components/TicketList";

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);

  useEffect(() => {
    api.get<Ticket[]>("/tickets?mine=true").then(setTickets);
  }, []);

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Meus chamados</h1>
        <Link href="/tickets/new" className="btn-primary">
          Abrir novo chamado
        </Link>
      </div>
      <TicketList tickets={tickets} />
    </div>
  );
}
