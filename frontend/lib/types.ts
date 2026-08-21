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

export type TicketClosureReason =
  | "resolvido"
  | "sem_interatividade"
  | "duplicado"
  | "resolvido_pelo_colaborador"
  | "cancelado_pelo_colaborador";

/** Motivos que o usuário atual pode usar, servidos por
 *  `GET /tickets/closure-reasons` — as mensagens padrão moram no backend
 *  para não existirem duas cópias do texto. */
export interface ClosureReasonOption {
  value: TicketClosureReason;
  label: string;
  default_message: string;
}

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
  closure_reason: TicketClosureReason | null;
}

export interface TicketHistoryEntry {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  comment: string | null;
  /** Nota interna do time de atendimento — a API nunca envia estas ao solicitante. */
  is_internal: boolean;
  created_at: string;
}

export interface TicketAttachmentEntry {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
}

export interface TicketDetail extends Ticket {
  history: TicketHistoryEntry[];
  attachments: TicketAttachmentEntry[];
  requester_name: string | null;
  requester_email: string | null;
  assigned_to_name: string | null;
  department_name: string | null;
}

export interface CannedResponse {
  id: string;
  title: string;
  content: string;
  department_id: string | null;
  created_by: string;
  created_at: string;
}

export type ConversationStatus = "ativa" | "encerrada";

export interface Conversation {
  id: string;
  title: string | null;
  status: ConversationStatus;
  closed_at: string | null;
  created_at: string;
}

export interface SourceRef {
  type: string;
  id: string;
  title: string;
  excerpt: string;
}

export type ChatDecision = "auto_answer" | "suggest_ticket" | "auto_ticket";

export interface TicketRef {
  id: string;
  ticket_number: string;
  priority: TicketPriority;
  sla_due_at: string | null;
}

export interface DraftTicketResponse {
  subject: string;
  description: string;
}

export interface MessageResponse {
  message_id: string;
  answer: string;
  confidence_score: number;
  decision: ChatDecision;
  sources: SourceRef[];
  ticket: TicketRef | null;
}

export interface ChatMessageRead {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  confidence_score: number | null;
  sources: SourceRef[] | null;
  /** Resposta ao "isso resolveu sua dúvida?"; `null` = ainda não respondeu. */
  was_helpful: boolean | null;
  created_at: string;
}

export interface DashboardSummary {
  total_atendimentos: number;
  total_chamados: number;
  taxa_resolucao_ia: number;
  taxa_abertura_chamado: number;
  sla_medio_horas: number;
  tempo_medio_resolucao_horas: number;
}

export interface DepartmentBreakdown {
  department: string;
  total_chamados: number;
  resolvidos: number;
  taxa_resolucao: number;
}
