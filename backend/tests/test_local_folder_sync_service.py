import os
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import DocumentSourceProvider
from app.models.knowledge import Document
from app.services import local_folder_sync_service
from app.services.local_folder_sync_service import (
    LocalSyncNotConfigured,
    _resolve_doc_type,
    sync_folder,
)


def test_resolve_doc_type_accepts_txt_and_pdf():
    assert _resolve_doc_type("politica-ferias.txt").value == "txt"
    assert _resolve_doc_type("guia-colaborador.PDF").value == "pdf"


def test_resolve_doc_type_rejects_other_extensions():
    assert _resolve_doc_type("planilha.xlsx") is None
    assert _resolve_doc_type("README") is None


@pytest.mark.asyncio
async def test_sync_folder_raises_when_not_configured(db_session: AsyncSession, monkeypatch):
    monkeypatch.setattr(local_folder_sync_service.settings, "LOCAL_KNOWLEDGE_FOLDER", None)
    with pytest.raises(LocalSyncNotConfigured):
        await sync_folder(db_session)


@pytest.mark.asyncio
async def test_sync_folder_raises_when_folder_missing(db_session: AsyncSession, monkeypatch, tmp_path: Path):
    monkeypatch.setattr(local_folder_sync_service.settings, "LOCAL_KNOWLEDGE_FOLDER", str(tmp_path / "nao-existe"))
    with pytest.raises(LocalSyncNotConfigured):
        await sync_folder(db_session)


@pytest.mark.asyncio
async def test_sync_folder_creates_reingests_and_skips_unchanged(
    db_session: AsyncSession, monkeypatch, tmp_path: Path
):
    monkeypatch.setattr(local_folder_sync_service.settings, "LOCAL_KNOWLEDGE_FOLDER", str(tmp_path))
    txt_file = tmp_path / "beneficios" / "vale-refeicao.txt"
    txt_file.parent.mkdir()
    txt_file.write_text("O vale refeição é depositado todo dia 25.", encoding="utf-8")
    (tmp_path / "logo.png").write_bytes(b"\x89PNG")  # formato não suportado

    with (
        patch("app.services.knowledge_service.embedding_service.embed_one", new=AsyncMock(return_value=[0.1] * 8)),
        patch("app.services.knowledge_service.vector_store.upsert", new=AsyncMock(return_value="point-1")),
    ):
        first = await sync_folder(db_session)
        assert first.created == ["beneficios/vale-refeicao.txt"]
        assert first.skipped_unsupported == ["logo.png"]
        assert first.errors == []

        document = (
            await db_session.execute(select(Document).where(Document.external_file_id == "beneficios/vale-refeicao.txt"))
        ).scalar_one()
        assert document.source_provider == DocumentSourceProvider.LOCAL_FOLDER

        # Segunda chamada sem nenhuma mudança no arquivo — não deve reprocessar.
        second = await sync_folder(db_session)
        assert second.skipped_unchanged == ["beneficios/vale-refeicao.txt"]
        assert second.created == []
        assert second.updated == []

        # Simula o arquivo sendo editado (mtime mais recente) — deve reingerir.
        new_mtime = datetime.now(timezone.utc).timestamp() + 5
        txt_file.write_text("O vale refeição é depositado todo dia 25, com desconto de 1 dia.", encoding="utf-8")
        os.utime(txt_file, (new_mtime, new_mtime))

        third = await sync_folder(db_session)
        assert third.updated == ["beneficios/vale-refeicao.txt"]


@pytest.mark.asyncio
async def test_sync_folder_records_error_without_stopping_others(
    db_session: AsyncSession, monkeypatch, tmp_path: Path
):
    monkeypatch.setattr(local_folder_sync_service.settings, "LOCAL_KNOWLEDGE_FOLDER", str(tmp_path))
    (tmp_path / "ok.txt").write_text("conteúdo válido", encoding="utf-8")

    with (
        patch(
            "app.services.knowledge_service.embedding_service.embed_one",
            new=AsyncMock(side_effect=RuntimeError("embedding indisponível")),
        ),
    ):
        result = await sync_folder(db_session)
        assert result.created == []
        assert len(result.errors) == 1
        assert "ok.txt" in result.errors[0]
