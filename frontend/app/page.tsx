"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Ticket } from "@/lib/types";
import ChatPanel from "@/components/ChatPanel";
import TicketList from "@/components/TicketList";

export default function HomePage() {
  const { user, loading } = useAuth();
  const [openTickets, setOpenTickets] = useState<Ticket[]>([]);
  const [closedTickets, setClosedTickets] = useState<Ticket[]>([]);

  useEffect(() => {
    if (!user) return;
    api.get<Ticket[]>("/tickets?mine=true").then((tickets) => {
      setOpenTickets(tickets.filter((t) => t.status !== "encerrado"));
      setClosedTickets(tickets.filter((t) => t.status === "encerrado"));
    });
  }, [user]);

  if (loading) return <p className="text-slate-500">Carregando...</p>;

  if (!user) {
    return (
      <div className="card mx-auto mt-16 max-w-md text-center">
        <h1 className="text-xl font-semibold">Bem-vindo(a) ao BEEP AI Service Desk</h1>
        <p className="mt-2 text-sm text-slate-500">Entre com sua conta corporativa para começar.</p>
        <Link href="/login" className="btn-primary mt-6 inline-flex">
          Entrar
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <ChatPanel />
      </div>
      <div className="space-y-6">
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Chamados abertos</h2>
            <Link href="/tickets/new" className="text-xs text-brand-600 hover:underline">
              Abrir manualmente
            </Link>
          </div>
          <TicketList tickets={openTickets} />
        </div>
        <div className="card">
          <h2 className="mb-3 font-semibold">Chamados encerrados</h2>
          <TicketList tickets={closedTickets} />
        </div>
      </div>
    </div>
  );
}
