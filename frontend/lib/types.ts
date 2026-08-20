export type UserRole = "employee" | "analyst" | "department_lead" | "admin";

export interface User {
  id: string;
  name: string;
  email: string;
  matricula: string | null;
  department_id: string | null;
  role: UserRole;
  is_active: boolean;
}

export interface Department {
  id: string;
  name: string;
  slug: string;
  default_sla_hours: number;
  is_active: boolean;
}

export type TicketStatus =
  | "novo"
  | "em_triagem"
  | "em_atendimento"
  | "aguardando_usuario"
  | "resolvido"
  | "encerrado";

export type TicketPriority = "baixa" | "media" | "alta" | "critica";
export type TicketSource = "ia_automatico" | "ia_sugerido" | "manual";

export interface Ticket {
  id: string;
  ticket_number: string;
  requester_id: string;
  matricula: string | null;
  area: string | null;
  department_id: string;
  category: string | null;
  subcategory: string | null;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  sla_due_at: string | null;
  assigned_to: string | null;
  source: TicketSource;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface TicketHistoryEntry {
  id: string;
  actor_id: string | null;
  action: string;
  comment: string | null;
  created_at: string;
}

export interface TicketDetail extends Ticket {
  history: TicketHistoryEntry[];
}

export interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
}

export interface SourceRef {
  type: string;
  id: string;
  title: string;
  excerpt: string;
}

export type ChatDecision = "auto_answer" | "suggest_ticket" | "auto_ticket";

export interface MessageResponse {
  message_id: string;
  answer: string;
  confidence_score: number;
  decision: ChatDecision;
  sources: SourceRef[];
  ticket: { id: string; ticket_number: string } | null;
}

export interface ChatMessageRead {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  confidence_score: number | null;
  sources: SourceRef[] | null;
  created_at: string;
}

export interface DashboardSummary {
  total_atendimentos: number;
  total_chamados: number;
  taxa_resolucao_ia: number;
  taxa_abertura_chamado: number;
  sla_medio_horas: number;
  tempo_medio_resolucao_horas: number;
  nps_interno: number;
  economia_estimada_reais: number;
}

export interface DepartmentBreakdown {
  department: string;
  total_chamados: number;
  resolvidos: number;
  taxa_resolucao: number;
}
