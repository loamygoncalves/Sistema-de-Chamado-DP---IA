"""Sincronização automática da base de conhecimento com uma pasta do Google
Drive. Um worker periódico (`app/workers/tasks.py`) chama `sync_folder()` a
cada `DRIVE_SYNC_INTERVAL_MINUTES`: arquivos novos são ingeridos, arquivos
alterados (`modifiedTime` mais recente que o registrado) são reingeridos, e
arquivos sem mudança são pulados sem custo de download ou de embeddings.

Requer uma conta de serviço do Google com a pasta compartilhada com o e-mail
dela (Compartilhar > colar o `client_email` do JSON da service account, papel
"Leitor"). Configuração via `GOOGLE_DRIVE_FOLDER_ID` e
`GOOGLE_SERVICE_ACCOUNT_FILE` (ver `.env.example`).
"""

from dataclasses import dataclass, field
from datetime import datetime

from google.oauth2 import service_account
from googleapiclient.discovery import Resource, build
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.department import Department
from app.models.enums import DocumentSourceProvider, DocumentType
from app.models.knowledge import Document
from app.services import knowledge_service

DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

# Tipos nativos do Google Workspace exigem exportação para um formato binário
# equivalente — não podem ser baixados como estão.
GOOGLE_NATIVE_EXPORT_MIME = {
    "application/vnd.google-apps.document": (
        "docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    "application/vnd.google-apps.spreadsheet": (
        "xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    "application/vnd.google-apps.presentation": (
        "pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ),
}


class DriveSyncNotConfigured(Exception):
    pass


@dataclass
class DriveSyncResult:
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    skipped_unchanged: list[str] = field(default_factory=list)
    skipped_unsupported: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def _build_drive_client() -> Resource:
    if not settings.GOOGLE_SERVICE_ACCOUNT_FILE:
        raise DriveSyncNotConfigured("GOOGLE_SERVICE_ACCOUNT_FILE não configurado")
    credentials = service_account.Credentials.from_service_account_file(
        settings.GOOGLE_SERVICE_ACCOUNT_FILE, scopes=DRIVE_SCOPES
    )
    return build("drive", "v3", credentials=credentials, cache_discovery=False)


def _parse_drive_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _resolve_doc_type(name: str, mime_type: str) -> tuple[DocumentType, str | None] | None:
    """Retorna (tipo_de_documento, mime_type_de_exportação_ou_None) — o segundo
    elemento só é preenchido para tipos nativos do Google que exigem export."""
    if mime_type in GOOGLE_NATIVE_EXPORT_MIME:
        extension, export_mime = GOOGLE_NATIVE_EXPORT_MIME[mime_type]
        return DocumentType(extension), export_mime

    extension = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    try:
        return DocumentType(extension), None
    except ValueError:
        return None


def _list_folder_files(drive: Resource, folder_id: str) -> list[dict]:
    files: list[dict] = []
    page_token = None
    query = f"'{folder_id}' in parents and trashed = false"
    while True:
        response = (
            drive.files()
            .list(
                q=query,
                fields="nextPageToken, files(id, name, mimeType, modifiedTime)",
                pageToken=page_token,
                pageSize=100,
            )
            .execute()
        )
        files.extend(response.get("files", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            break
    return files


def _download_content(drive: Resource, file_id: str, export_mime: str | None) -> bytes:
    request = drive.files().export_media(fileId=file_id, mimeType=export_mime) if export_mime else drive.files().get_media(fileId=file_id)
    return request.execute()


async def _resolve_default_department_id(db: AsyncSession):
    if not settings.GOOGLE_DRIVE_DEFAULT_DEPARTMENT_SLUG:
        return None
    department = (
        await db.execute(select(Department).where(Department.slug == settings.GOOGLE_DRIVE_DEFAULT_DEPARTMENT_SLUG))
    ).scalar_one_or_none()
    return department.id if department else None


async def sync_folder(db: AsyncSession) -> DriveSyncResult:
    if not settings.GOOGLE_DRIVE_FOLDER_ID:
        raise DriveSyncNotConfigured("GOOGLE_DRIVE_FOLDER_ID não configurado")

    drive = _build_drive_client()
    department_id = await _resolve_default_department_id(db)
    result = DriveSyncResult()

    for remote_file in _list_folder_files(drive, settings.GOOGLE_DRIVE_FOLDER_ID):
        file_id, name = remote_file["id"], remote_file["name"]
        try:
            resolved = _resolve_doc_type(name, remote_file["mimeType"])
            if resolved is None:
                result.skipped_unsupported.append(name)
                continue
            doc_type, export_mime = resolved
            modified_time = _parse_drive_timestamp(remote_file["modifiedTime"])

            existing = (
                await db.execute(select(Document).where(Document.external_file_id == file_id))
            ).scalar_one_or_none()

            if existing is not None and existing.external_modified_time is not None:
                if existing.external_modified_time >= modified_time:
                    result.skipped_unchanged.append(name)
                    continue

            content = _download_content(drive, file_id, export_mime)

            if existing is None:
                await knowledge_service.ingest_document(
                    db,
                    filename=name,
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
