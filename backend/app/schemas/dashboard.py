from pydantic import BaseModel


class DashboardSummary(BaseModel):
    total_atendimentos: int
    total_chamados: int
    taxa_resolucao_ia: float
    taxa_abertura_chamado: float
    sla_medio_horas: float
    tempo_medio_resolucao_horas: float
    nps_interno: float
    economia_estimada_reais: float


class DepartmentBreakdown(BaseModel):
    department: str
    total_chamados: int
    resolvidos: int
    taxa_resolucao: float


class AISettingsRead(BaseModel):
    confidence_threshold_auto: float
    confidence_threshold_suggest: float
    default_llm_provider: str
    default_llm_model: str
    rag_top_k: int


class AISettingsUpdate(BaseModel):
    confidence_threshold_auto: float | None = None
    confidence_threshold_suggest: float | None = None
    default_llm_provider: str | None = None
    default_llm_model: str | None = None
    rag_top_k: int | None = None
