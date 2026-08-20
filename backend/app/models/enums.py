import enum


class UserRole(str, enum.Enum):
    EMPLOYEE = "employee"
    ANALYST = "analyst"
    DEPARTMENT_LEAD = "department_lead"
    ADMIN = "admin"


class TicketPriority(str, enum.Enum):
    BAIXA = "baixa"
    MEDIA = "media"
    ALTA = "alta"
    CRITICA = "critica"


class TicketStatus(str, enum.Enum):
    NOVO = "novo"
    EM_TRIAGEM = "em_triagem"
    EM_ATENDIMENTO = "em_atendimento"
    AGUARDANDO_USUARIO = "aguardando_usuario"
    RESOLVIDO = "resolvido"
    ENCERRADO = "encerrado"


class TicketSource(str, enum.Enum):
    IA_AUTOMATICO = "ia_automatico"
    IA_SUGERIDO = "ia_sugerido"
    MANUAL = "manual"


class KnowledgeSourceType(str, enum.Enum):
    MANUAL = "manual"
    FAQ = "faq"
    POLICY = "policy"
    GENERATED = "generated"


class DocumentType(str, enum.Enum):
    PDF = "pdf"
    DOCX = "docx"
    XLSX = "xlsx"
    CSV = "csv"
    PPTX = "pptx"


class DocumentSourceProvider(str, enum.Enum):
    UPLOAD = "upload"
    GOOGLE_DRIVE = "google_drive"


class ChatRole(str, enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class ChatDecision(str, enum.Enum):
    AUTO_ANSWER = "auto_answer"
    SUGGEST_TICKET = "suggest_ticket"
    AUTO_TICKET = "auto_ticket"


class ChatConversationStatus(str, enum.Enum):
    ATIVA = "ativa"
    ENCERRADA = "encerrada"
