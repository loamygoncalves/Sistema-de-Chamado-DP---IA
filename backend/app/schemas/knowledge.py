import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import DocumentSourceProvider, DocumentType, KnowledgeSourceType


class ArticleCreate(BaseModel):
    title: str
    content: str
    department_id: uuid.UUID | None = None
    tags: list[str] | None = None


class ArticleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    content: str
    source_type: KnowledgeSourceType
    department_id: uuid.UUID | None
    tags: list[str] | None
    created_at: datetime


class FAQCreate(BaseModel):
    question: str
    answer: str
    department_id: uuid.UUID | None = None


class FAQRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    question: str
    answer: str
    department_id: uuid.UUID | None
    is_active: bool


class DocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    file_type: DocumentType
    department_id: uuid.UUID | None
    indexed_at: datetime | None
    chunk_count: int
    source_provider: DocumentSourceProvider
    external_file_id: str | None


class LocalSyncResult(BaseModel):
    created: list[str]
    updated: list[str]
    skipped_unchanged: list[str]
    skipped_unsupported: list[str]
    errors: list[str]


class DriveSyncResult(BaseModel):
    created: list[str]
    updated: list[str]
    skipped_unchanged: list[str]
    skipped_unsupported: list[str]
    errors: list[str]
