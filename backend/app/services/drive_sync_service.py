"""Sincronização automática da base de conhecimento com uma pasta do Google
Drive — alternativa a `local_folder_sync_service` para quando não existe um
servidor de arquivos de rede real, mas o conteúdo já mora numa pasta/Drive
compartilhado do Google Workspace.

Diferente de uma pasta mapeada no computador de alguém (que só existe
enquanto aquele computador está ligado e montado), esta sincronização fala
direto com a API do Google Drive usando uma *service account* — então
funciona de qualquer lugar onde o backend estiver rodando (local, AWS etc.),
sem depender de máquina nenhuma. Configuração em
`docs/GOOGLE_DRIVE_SETUP.md`.

`sync_drive_folder()` é chamada automaticamente no início de cada resposta
da IA (`chat_service.ask_question`), igual à sincronização de pasta local —
arquivos sem mudança (mesmo `modifiedTime` já registrado) são pulados sem
custo de reembedding. Também pode ser disparada sob demanda via
`POST /knowledge/documents/sync-drive`.

Formatos suportados: `.txt`, `.pdf` e Documentos Google nativos (exportados
como texto simples).
"""

import json
from dataclasses import dataclass, field
from datetime import datetime

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.department import Department
from app.models.enums import DocumentSourceProvider, DocumentType
from app.models.knowledge import Document
from app.services import knowledge_service

_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
_GOOGLE_DOC_MIME_TYPE = "application/vnd.google-apps.document"
_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
_EXTENSION_TO_DOC_TYPE = {"txt": DocumentType.TXT, "pdf": DocumentType.PDF}


class DriveSyncNotConfigured(Exception):
    pass


@dataclass
class DriveSyncResult:
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    skipped_unchanged: list[str] = field(default_factory=list)
    skipped_unsupported: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def _build_drive_client():
    if not settings.GOOGLE_DRIVE_FOLDER_ID or not settings.GOOGLE_SERVICE_ACCOUNT_JSON:
        raise DriveSyncNotConfigured(
            "GOOGLE_DRIVE_FOLDER_ID e GOOGLE_SERVICE_ACCOUNT_JSON precisam estar configurados"
        )
    try:
        info = json.loads(settings.GOOGLE_SERVICE_ACCOUNT_JSON)
    except json.JSONDecodeError as exc:
        raise DriveSyncNotConfigured("GOOGLE_SERVICE_ACCOUNT_JSON não é um JSON válido") from exc

    credentials = service_account.Credentials.from_service_account_info(info, scopes=_SCOPES)
    return build("drive", "v3", credentials=credentials, cache_discovery=False)


def _resolve_doc_type(name: str, mime_type: str) -> DocumentType | None:
    if mime_type == _GOOGLE_DOC_MIME_TYPE:
        return DocumentType.TXT
    extension = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    return _EXTENSION_TO_DOC_TYPE.get(extension)


def _list_files_recursive(drive, root_folder_id: str) -> list[dict]:
    """Lista todos os arquivos da pasta e subpastas, sem paginar de forma
    recursiva-infinita: cada subpasta encontrada entra na fila de pastas a
    percorrer."""
    files: list[dict] = []
    pending_folder_ids = [root_folder_id]

    while pending_folder_ids:
        folder_id = pending_folder_ids.pop()
        page_token = None
        while True:
            response = (
                drive.files()
                .list(
                    q=f"'{folder_id}' in parents and trashed = false",
                    fields="nextPageToken, files(id, name, mimeType, modifiedTime)",
                    pageToken=page_token,
                    pageSize=200,
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True,
                )
                .execute()
            )
            for entry in response.get("files", []):
                if entry["mimeType"] == _FOLDER_MIME_TYPE:
                    pending_folder_ids.append(entry["id"])
                else:
                    files.append(entry)
            page_token = response.get("nextPageToken")
            if not page_token:
                break

    return files


def _download_content(drive, file_id: str, mime_type: str) -> bytes:
    if mime_type == _GOOGLE_DOC_MIME_TYPE:
        return drive.files().export(fileId=file_id, mimeType="text/plain").execute()
    return drive.files().get_media(fileId=file_id).execute()


async def _resolve_default_department_id(db: AsyncSession):
    if not settings.GOOGLE_DRIVE_DEFAULT_DEPARTMENT_SLUG:
        return None
    department = (
        await db.execute(
            select(Department).where(Department.slug == settings.GOOGLE_DRIVE_DEFAULT_DEPARTMENT_SLUG)
        )
    ).scalar_one_or_none()
    return department.id if department else None


async def sync_drive_folder(db: AsyncSession) -> DriveSyncResult:
    drive = _build_drive_client()
    department_id = await _resolve_default_department_id(db)
    result = DriveSyncResult()

    try:
        files = _list_files_recursive(drive, settings.GOOGLE_DRIVE_FOLDER_ID)
    except HttpError as exc:
        raise DriveSyncNotConfigured(
            f"Não foi possível listar a pasta no Drive (verifique se ela foi compartilhada com a "
            f"service account): {exc}"
        ) from exc

    for entry in files:
        file_id = entry["id"]
        name = entry["name"]
        try:
            doc_type = _resolve_doc_type(name, entry["mimeType"])
            if doc_type is None:
                result.skipped_unsupported.append(name)
                continue

            modified_time = datetime.fromisoformat(entry["modifiedTime"].replace("Z", "+00:00"))

            existing = (
                await db.execute(select(Document).where(Document.external_file_id == file_id))
            ).scalar_one_or_none()

            if existing is not None and existing.external_modified_time is not None:
                if existing.external_modified_time >= modified_time:
                    result.skipped_unchanged.append(name)
                    continue

            content = _download_content(drive, file_id, entry["mimeType"])

            if existing is None:
                await knowledge_service.ingest_document(
                    db,
                    filename=name if doc_type != DocumentType.TXT or name.endswith(".txt") else f"{name}.txt",
                    file_type=doc_type,
                    content=content,
                    department_id=department_id,
                    source_provider=DocumentSourceProvider.GOOGLE_DRIVE,
                    external_file_id=file_id,
                    external_modified_time=modified_time,
                )
                result.created.append(name)
            else:
                await knowledge_service.reingest_document(
                    db, existing, content=content, external_modified_time=modified_time
                )
                result.updated.append(name)
        except Exception as exc:  # noqa: BLE001 — um arquivo com erro não deve interromper a sincronização inteira
            result.errors.append(f"{name}: {exc}")

    return result
