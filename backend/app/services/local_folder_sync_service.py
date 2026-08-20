"""Sincronização automática da base de conhecimento com uma pasta local ou de
rede — 100% local, sem custo e sem depender de nenhuma API externa.

`sync_folder()` é chamada automaticamente no início de cada resposta da IA
(`chat_service.ask_question`), então a base fica sempre atualizada com o
conteúdo mais recente da pasta antes de responder. Arquivos sem mudança
(mesmo `mtime` já registrado) são pulados sem custo de leitura/embedding —
só arquivos novos ou alterados são de fato reprocessados. Também pode ser
disparada sob demanda via `POST /knowledge/documents/sync-local`.

Formatos suportados: `.txt` e `.pdf`. Configuração via `LOCAL_KNOWLEDGE_FOLDER`
(caminho da pasta, montada no container) — ver `.env.example` e
`docs/LOCAL_KNOWLEDGE_SETUP.md`.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.department import Department
from app.models.enums import DocumentSourceProvider, DocumentType
from app.models.knowledge import Document
from app.services import knowledge_service

SUPPORTED_EXTENSIONS = {"txt", "pdf"}


class LocalSyncNotConfigured(Exception):
    pass


@dataclass
class LocalSyncResult:
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    skipped_unchanged: list[str] = field(default_factory=list)
    skipped_unsupported: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def _resolve_doc_type(filename: str) -> DocumentType | None:
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in SUPPORTED_EXTENSIONS:
        return None
    return DocumentType(extension)


def _iter_folder_files(folder: Path):
    for path in sorted(folder.rglob("*")):
        if path.is_file() and not path.name.startswith("."):
            yield path


async def _resolve_default_department_id(db: AsyncSession):
    if not settings.LOCAL_KNOWLEDGE_DEFAULT_DEPARTMENT_SLUG:
        return None
    department = (
        await db.execute(
            select(Department).where(Department.slug == settings.LOCAL_KNOWLEDGE_DEFAULT_DEPARTMENT_SLUG)
        )
    ).scalar_one_or_none()
    return department.id if department else None


async def sync_folder(db: AsyncSession) -> LocalSyncResult:
    if not settings.LOCAL_KNOWLEDGE_FOLDER:
        raise LocalSyncNotConfigured("LOCAL_KNOWLEDGE_FOLDER não configurado")

    folder = Path(settings.LOCAL_KNOWLEDGE_FOLDER)
    if not folder.is_dir():
        raise LocalSyncNotConfigured(f"Pasta não encontrada ou inacessível: {folder}")

    department_id = await _resolve_default_department_id(db)
    result = LocalSyncResult()

    for path in _iter_folder_files(folder):
        relative_id = str(path.relative_to(folder))
        try:
            doc_type = _resolve_doc_type(path.name)
            if doc_type is None:
                result.skipped_unsupported.append(relative_id)
                continue

            modified_time = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)

            existing = (
                await db.execute(select(Document).where(Document.external_file_id == relative_id))
            ).scalar_one_or_none()

            if existing is not None and existing.external_modified_time is not None:
                if existing.external_modified_time >= modified_time:
                    result.skipped_unchanged.append(relative_id)
                    continue

            content = path.read_bytes()

            if existing is None:
                await knowledge_service.ingest_document(
                    db,
                    filename=path.name,
                    file_type=doc_type,
                    content=content,
                    department_id=department_id,
                    source_provider=DocumentSourceProvider.LOCAL_FOLDER,
                    external_file_id=relative_id,
                    external_modified_time=modified_time,
                )
                result.created.append(relative_id)
            else:
                await knowledge_service.reingest_document(
                    db, existing, content=content, external_modified_time=modified_time
                )
                result.updated.append(relative_id)
        except Exception as exc:  # noqa: BLE001 — um arquivo com erro não deve interromper a sincronização inteira
            result.errors.append(f"{relative_id}: {exc}")

    return result
