"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import type { DashboardSummary, DepartmentBreakdown } from "@/lib/types";
import StatCard from "@/components/StatCard";

const PIE_COLORS = ["#1466ff", "#f59e0b"];

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [byDepartment, setByDepartment] = useState<DepartmentBreakdown[]>([]);

  useEffect(() => {
    api.get<DashboardSummary>("/dashboard/summary").then(setSummary);
    api.get<DepartmentBreakdown[]>("/dashboard/by-department").then(setByDepartment);
  }, []);

  if (!summary) return <p className="text-slate-500">Carregando indicadores...</p>;

  const pieData = [
    { name: "Resolvido pela IA", value: summary.taxa_resolucao_ia },
    { name: "Abriu chamado", value: summary.taxa_abertura_chamado },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Dashboard gerencial</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total de atendimentos" value={summary.total_atendimentos.toLocaleString("pt-BR")} />
        <StatCard label="Total de chamados" value={summary.total_chamados.toLocaleString("pt-BR")} />
        <StatCard label="Taxa de resolução por IA" value={`${(summary.taxa_resolucao_ia * 100).toFixed(1)}%`} />
        <StatCard label="Taxa de abertura de chamado" value={`${(summary.taxa_abertura_chamado * 100).toFixed(1)}%`} />
        <StatCard label="SLA médio" value={`${summary.sla_medio_horas.toFixed(1)}h`} />
        <StatCard label="Tempo médio de resolução" value={`${summary.tempo_medio_resolucao_horas.toFixed(1)}h`} />
        <StatCard label="NPS interno" value={summary.nps_interno.toFixed(0)} />
        <StatCard
          label="Economia gerada pela automação"
          value={summary.economia_estimada_reais.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 font-semibold">IA vs. abertura de chamado</h2>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100}>
                {pieData.map((_, index) => (
                  <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => `${(value * 100).toFixed(1)}%`} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2 className="mb-3 font-semibold">Chamados por área</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byDepartment} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="department" width={140} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="total_chamados" fill="#1466ff" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
