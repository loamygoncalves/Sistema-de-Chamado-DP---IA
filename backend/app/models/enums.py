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


class TicketClosureReason(str, enum.Enum):
    """Motivo do encerramento — obrigatório ao encerrar. É o que permite
    separar, no relatório, o que foi de fato resolvido do que morreu por
    falta de retorno do colaborador."""

    RESOLVIDO = "resolvido"
    SEM_INTERATIVIDADE = "sem_interatividade"
    DUPLICADO = "duplicado"
    RESOLVIDO_PELO_COLABORADOR = "resolvido_pelo_colaborador"
    CANCELADO_PELO_COLABORADOR = "cancelado_pelo_colaborador"


# Quem pode encerrar com qual motivo. "Sem interatividade" é um julgamento do
# time de atendimento; "cancelado"/"resolvi sozinho" é do colaborador.
CLOSURE_REASONS_STAFF = frozenset(
    {
        TicketClosureReason.RESOLVIDO,
        TicketClosureReason.SEM_INTERATIVIDADE,
        TicketClosureReason.DUPLICADO,
    }
)
CLOSURE_REASONS_REQUESTER = frozenset(
    {
        TicketClosureReason.RESOLVIDO_PELO_COLABORADOR,
        TicketClosureReason.CANCELADO_PELO_COLABORADOR,
    }
)


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
    TXT = "txt"


class DocumentSourceProvider(str, enum.Enum):
    UPLOAD = "upload"
    LOCAL_FOLDER = "local_folder"


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
