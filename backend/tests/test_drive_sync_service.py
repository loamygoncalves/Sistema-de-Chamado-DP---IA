from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import DocumentSourceProvider
from app.models.knowledge import Document
from app.services import drive_sync_service
from app.services.drive_sync_service import DriveSyncNotConfigured, _resolve_doc_type, sync_drive_folder

ROOT_FOLDER_ID = "root-folder-id"


def test_resolve_doc_type_accepts_txt_pdf_and_google_doc():
    assert _resolve_doc_type("politica-ferias.txt", "text/plain").value == "txt"
    assert _resolve_doc_type("guia-colaborador.PDF", "application/pdf").value == "pdf"
    assert _resolve_doc_type("Guia do Colaborador", "application/vnd.google-apps.document").value == "txt"


def test_resolve_doc_type_rejects_other_formats():
    assert _resolve_doc_type("planilha.xlsx", "application/vnd.ms-excel") is None
    assert _resolve_doc_type("imagem", "application/vnd.google-apps.folder") is None


class _FakeExecutable:
    def __init__(self, value):
        self._value = value

    def execute(self):
        return self._value


class _FakeFilesResource:
    """Simula o suficiente da API fluente `drive.files()` do
    googleapiclient para exercitar a listagem recursiva e o download."""

    def __init__(self, entries_by_folder: dict[str, list[dict]], media: dict[str, bytes], exports: dict[str, bytes]):
        self._entries_by_folder = entries_by_folder
        self._media = media
        self._exports = exports

    def list(self, *, q, fields, pageToken, pageSize, supportsAllDrives, includeItemsFromAllDrives):
        folder_id = q.split("'")[1]
        entries = self._entries_by_folder.get(folder_id, [])
        return _FakeExecutable({"files": entries, "nextPageToken": None})

    def get_media(self, *, fileId):
        return _FakeExecutable(self._media[fileId])

    def export(self, *, fileId, mimeType):
        return _FakeExecutable(self._exports[fileId])


class _FakeDrive:
    def __init__(self, files_resource: _FakeFilesResource):
        self._files_resource = files_resource

    def files(self):
        return self._files_resource


def _fake_drive_client(entries_by_folder, media=None, exports=None):
    return _FakeDrive(_FakeFilesResource(entries_by_folder, media or {}, exports or {}))


@pytest.mark.asyncio
async def test_sync_drive_folder_raises_when_not_configured(db_session: AsyncSession, monkeypatch):
    monkeypatch.setattr(drive_sync_service.settings, "GOOGLE_DRIVE_FOLDER_ID", None)
    monkeypatch.setattr(drive_sync_service.settings, "GOOGLE_SERVICE_ACCOUNT_JSON", None)
    with pytest.raises(DriveSyncNotConfigured):
        await sync_drive_folder(db_session)


@pytest.mark.asyncio
async def test_sync_drive_folder_raises_when_service_account_json_invalid(db_session: AsyncSession, monkeypatch):
    monkeypatch.setattr(drive_sync_service.settings, "GOOGLE_DRIVE_FOLDER_ID", ROOT_FOLDER_ID)
    monkeypatch.setattr(drive_sync_service.settings, "GOOGLE_SERVICE_ACCOUNT_JSON", "isso não é um JSON")
    with pytest.raises(DriveSyncNotConfigured):
        await sync_drive_folder(db_session)


@pytest.mark.asyncio
async def test_sync_drive_folder_creates_updates_and_skips_unchanged(db_session: AsyncSession, monkeypatch):
    monkeypatch.setattr(drive_sync_service.settings, "GOOGLE_DRIVE_FOLDER_ID", ROOT_FOLDER_ID)
    monkeypatch.setattr(drive_sync_service.settings, "GOOGLE_SERVICE_ACCOUNT_JSON", '{"type": "service_account"}')

    entries_by_folder = {
        ROOT_FOLDER_ID: [
            {
                "id": "file-1",
                "name": "vale-refeicao.txt",
                "mimeType": "text/plain",
                "modifiedTime": "2026-01-01T00:00:00.000Z",
            },
            {"id": "logo", "name": "logo.png", "mimeType": "image/png", "modifiedTime": "2026-01-01T00:00:00.000Z"},
        ]
    }
    media = {"file-1": b"O vale refeicao e depositado todo dia 25."}

    with (
        patch.object(drive_sync_service, "_build_drive_client", return_value=_fake_drive_client(entries_by_folder, media)),
        patch("app.services.knowledge_service.embedding_service.embed_one", new=AsyncMock(return_value=[0.1] * 8)),
        patch("app.services.knowledge_service.vector_store.upsert", new=AsyncMock(return_value="point-1")),
    ):
        first = await sync_drive_folder(db_session)
        assert first.created == ["vale-refeicao.txt"]
        assert first.skipped_unsupported == ["logo.png"]
        assert first.errors == []

        document = (
            await db_session.execute(select(Document).where(Document.external_file_id == "file-1"))
        ).scalar_one()
        assert document.source_provider == DocumentSourceProvider.GOOGLE_DRIVE

        # Sem mudança no modifiedTime — não deve reprocessar.
        second = await sync_drive_folder(db_session)
        assert second.skipped_unchanged == ["vale-refeicao.txt"]
        assert second.created == []
        assert second.updated == []

    # Simula edição no Drive (modifiedTime mais recente + conteúdo novo).
    entries_by_folder[ROOT_FOLDER_ID][0]["modifiedTime"] = "2026-01-02T00:00:00.000Z"
    media["file-1"] = b"O vale refeicao e depositado todo dia 25, com desconto de 1 dia."

    with (
        patch.object(drive_sync_service, "_build_drive_client", return_value=_fake_drive_client(entries_by_folder, media)),
        patch("app.services.knowledge_service.embedding_service.embed_one", new=AsyncMock(return_value=[0.1] * 8)),
        patch("app.services.knowledge_service.vector_store.upsert", new=AsyncMock(return_value="point-2")),
    ):
        third = await sync_drive_folder(db_session)
        assert third.updated == ["vale-refeicao.txt"]


@pytest.mark.asyncio
async def test_sync_drive_folder_recurses_into_subfolders(db_session: AsyncSession, monkeypatch):
    monkeypatch.setattr(drive_sync_service.settings, "GOOGLE_DRIVE_FOLDER_ID", ROOT_FOLDER_ID)
    monkeypatch.setattr(drive_sync_service.settings, "GOOGLE_SERVICE_ACCOUNT_JSON", '{"type": "service_account"}')

    entries_by_folder = {
        ROOT_FOLDER_ID: [
            {
                "id": "subfolder-1",
                "name": "beneficios",
                "mimeType": "application/vnd.google-apps.folder",
                "modifiedTime": "2026-01-01T00:00:00.000Z",
            }
        ],
        "subfolder-1": [
            {
                "id": "file-2",
                "name": "Guia de Beneficios",
                "mimeType": "application/vnd.google-apps.document",
                "modifiedTime": "2026-01-01T00:00:00.000Z",
            }
        ],
    }
    exports = {"file-2": b"Conteudo exportado do Google Docs."}

    with (
        patch.object(
            drive_sync_service, "_build_drive_client", return_value=_fake_drive_client(entries_by_folder, exports=exports)
        ),
        patch("app.services.knowledge_service.embedding_service.embed_one", new=AsyncMock(return_value=[0.1] * 8)),
        patch("app.services.knowledge_service.vector_store.upsert", new=AsyncMock(return_value="point-1")),
    ):
        result = await sync_drive_folder(db_session)
        assert result.created == ["Guia de Beneficios"]

        document = (
            await db_session.execute(select(Document).where(Document.external_file_id == "file-2"))
        ).scalar_one()
        assert document.file_type.value == "txt"


@pytest.mark.asyncio
async def test_sync_drive_folder_records_error_without_stopping_others(db_session: AsyncSession, monkeypatch):
    monkeypatch.setattr(drive_sync_service.settings, "GOOGLE_DRIVE_FOLDER_ID", ROOT_FOLDER_ID)
    monkeypatch.setattr(drive_sync_service.settings, "GOOGLE_SERVICE_ACCOUNT_JSON", '{"type": "service_account"}')

    entries_by_folder = {
        ROOT_FOLDER_ID: [
            {"id": "file-1", "name": "ok.txt", "mimeType": "text/plain", "modifiedTime": "2026-01-01T00:00:00.000Z"}
        ]
    }
    media = {"file-1": b"conteudo valido"}

    with (
        patch.object(drive_sync_service, "_build_drive_client", return_value=_fake_drive_client(entries_by_folder, media)),
        patch(
            "app.services.knowledge_service.embedding_service.embed_one",
            new=AsyncMock(side_effect=RuntimeError("embedding indisponível")),
        ),
    ):
        result = await sync_drive_folder(db_session)
        assert result.created == []
        assert len(result.errors) == 1
        assert "ok.txt" in result.errors[0]
