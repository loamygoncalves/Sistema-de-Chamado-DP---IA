"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Department, Ticket, TicketStatus } from "@/lib/types";
import TicketList from "@/components/TicketList";

const STATUS_FILTERS: { value: TicketStatus | ""; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "novo", label: "Novos" },
  { value: "em_triagem", label: "Em triagem" },
  { value: "em_atendimento", label: "Em atendimento" },
  { value: "aguardando_usuario", label: "Aguardando usuário" },
  { value: "resolvido", label: "Resolvidos" },
];

type ViewMode = "inbox" | "mine" | "all";

const VIEW_TABS: { value: ViewMode; label: string }[] = [
  { value: "inbox", label: "Caixa de entrada" },
  { value: "mine", label: "Meus atendimentos" },
  { value: "all", label: "Todos os chamados" },
];

export default function AnalystQueuePage() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  // A caixa de entrada geral (chamados sem analista) é a tela principal — é
  // para ela que o time olha primeiro ao começar o turno.
  const [viewMode, setViewMode] = useState<ViewMode>("inbox");
  const [statusFilter, setStatusFilter] = useState<TicketStatus | "">("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [pendingAnalystOnly, setPendingAnalystOnly] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get<Department[]>("/departments").then(setDepartments);
  }, []);

  useEffect(() => {
    // Busca com um pequeno atraso, para não disparar uma chamada a cada
    // tecla digitada.
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (viewMode === "inbox") params.set("unassigned", "true");
      if (viewMode === "mine" && user) params.set("assigned_to", user.id);
      if (statusFilter) params.set("status", statusFilter);
      if (departmentFilter) params.set("department_id", departmentFilter);
      if (overdueOnly) params.set("overdue", "true");
      if (pendingAnalystOnly) params.set("pending_analyst", "true");
      if (search.trim()) params.set("q", search.trim());
      api.get<Ticket[]>(`/tickets?${params.toString()}`).then(setTickets);
    }, 300);
    return () => clearTimeout(timer);
  }, [viewMode, statusFilter, departmentFilter, overdueOnly, pendingAnalystOnly, search, user]);

  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Fila do analista</h1>
          <div className="flex rounded-lg border border-slate-300 p-0.5 text-sm">
            {VIEW_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setViewMode(tab.value)}
                className={`rounded-md px-3 py-1 ${viewMode === tab.value ? "bg-brand-700 text-white" : "text-slate-600"}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <Link href="/analyst/knowledge/new" className="btn-secondary">
          Novo artigo de conhecimento
        </Link>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por protocolo, matrícula, colaborador ou assunto..."
          className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TicketStatus | "")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Todas as filas</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => setOverdueOnly((v) => !v)}
          className={`rounded-full border px-3 py-1.5 text-sm ${overdueOnly ? "border-red-600 bg-red-600 text-white" : "border-slate-300 text-slate-600"}`}
        >
          Atrasados
        </button>
        <button
          onClick={() => setPendingAnalystOnly((v) => !v)}
          className={`rounded-full border px-3 py-1.5 text-sm ${pendingAnalystOnly ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 text-slate-600"}`}
        >
          Pendente interação do analista
        </button>
      </div>
      <TicketList tickets={tickets} basePath="/analyst" />
    </div>
  );
}
