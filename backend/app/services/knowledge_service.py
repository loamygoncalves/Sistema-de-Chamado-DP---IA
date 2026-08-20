import hashlib
import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import DocumentSourceProvider, DocumentType, KnowledgeSourceType
from app.models.knowledge import FAQ, Document, KnowledgeArticle
from app.services.embeddings import embedding_service
from app.services.ingestion_service import extract_chunks
from app.services.vector_store import vector_store

# Namespace fixo para gerar ids determinísticos de ponto no Qdrant a partir de
# (documento, índice do chunk) — permite reingestão idempotente: reindexar o
# mesmo documento sobrescreve os mesmos pontos em vez de duplicá-los.
_CHUNK_POINT_NAMESPACE = uuid.UUID("6f6f6d9a-2f0a-4e7e-9c8a-9f7e2a5b3c1d")


def _chunk_point_id(document_id: uuid.UUID, index: int) -> str:
    return str(uuid.uuid5(_CHUNK_POINT_NAMESPACE, f"{document_id}:{index}"))


async def index_article(db: AsyncSession, article: KnowledgeArticle) -> None:
    vector = await embedding_service.embed_one(f"{article.title}\n{article.content}")
    payload = {
        "source_id": str(article.id),
        "source_type": article.source_type.value,
        "title": article.title,
        "text": article.content,
        "department_id": str(article.department_id) if article.department_id else None,
    }
    point_id = await vector_store.upsert(vector=vector, payload=payload, point_id=article.vector_id)
    article.vector_id = point_id
    await db.flush()


async def create_manual_article(
    db: AsyncSession, *, title: str, content: str, department_id: uuid.UUID | None, tags: list[str] | None, created_by: uuid.UUID
) -> KnowledgeArticle:
    article = KnowledgeArticle(
        title=title,
        content=content,
        source_type=KnowledgeSourceType.MANUAL,
        department_id=department_id,
        tags=tags,
        created_by=created_by,
    )
    db.add(article)
    await db.flush()
    await index_article(db, article)
    return article


async def index_faq(db: AsyncSession, faq: FAQ) -> None:
    vector = await embedding_service.embed_one(f"{faq.question}\n{faq.answer}")
    payload = {
        "source_id": str(faq.id),
        "source_type": "faq",
        "title": faq.question,
        "text": faq.answer,
        "department_id": str(faq.department_id) if faq.department_id else None,
    }
    point_id = await vector_store.upsert(vector=vector, payload=payload, point_id=faq.vector_id)
    faq.vector_id = point_id
    await db.flush()


async def create_faq(db: AsyncSession, *, question: str, answer: str, department_id: uuid.UUID | None) -> FAQ:
    faq = FAQ(question=question, answer=answer, department_id=department_id)
    db.add(faq)
    await db.flush()
    await index_faq(db, faq)
    return faq


async def _index_document_chunks(db: AsyncSession, document: Document, content: bytes) -> None:
    """(Re)gera os pontos vetoriais de um documento com ids determinísticos —
    reindexar o mesmo `document.id` sobrescreve os pontos existentes em vez de
    duplicá-los. Se a nova versão tiver menos chunks que a anterior, os pontos
    excedentes da versão antiga são removidos do Qdrant."""
    previous_chunk_count = document.chunk_count
    chunks = extract_chunks(document.file_type.value, content)

    for index, chunk in enumerate(chunks):
        vector = await embedding_service.embed_one(chunk["text"])
        await vector_store.upsert(
            vector=vector,
            point_id=_chunk_point_id(document.id, index),
            payload={
                "source_id": str(document.id),
                "source_type": "documento",
                "title": f"{document.filename} ({chunk['metadata']})",
                "text": chunk["text"],
                "department_id": str(document.department_id) if document.department_id else None,
            },
        )

    for stale_index in range(len(chunks), previous_chunk_count):
        await vector_store.delete(_chunk_point_id(document.id, stale_index))

    document.chunk_count = len(chunks)
    document.indexed_at = datetime.now(timezone.utc)
    await db.flush()


async def ingest_document(
    db: AsyncSession,
    *,
    filename: str,
    file_type: DocumentType,
    content: bytes,
    department_id: uuid.UUID | None,
    uploaded_by: uuid.UUID | None = None,
    source_provider: DocumentSourceProvider = DocumentSourceProvider.UPLOAD,
    external_file_id: str | None = None,
    external_modified_time: datetime | None = None,
) -> Document:
    checksum = hashlib.sha256(content).hexdigest()
    document = Document(
        filename=filename,
        file_type=file_type,
        department_id=department_id,
        storage_path=f"documents/{checksum}_{filename}",
        checksum=checksum,
        uploaded_by=uploaded_by,
        source_provider=source_provider,
        external_file_id=external_file_id,
        external_modified_time=external_modified_time,
    )
    db.add(document)
    await db.flush()

    await _index_document_chunks(db, document, content)
    return document


async def reingest_document(
    db: AsyncSession, document: Document, *, content: bytes, external_modified_time: datetime | None = None
) -> Document:
    """Atualiza um documento já existente (tipicamente sincronizado do Google
    Drive) com uma nova versão do conteúdo. Não faz nada se o conteúdo não
    mudou — evita reembedar e regravar vetores sem necessidade."""
    checksum = hashlib.sha256(content).hexdigest()
    if checksum == document.checksum:
        document.external_modified_time = external_modified_time
        await db.flush()
        return document

    document.checksum = checksum
    document.storage_path = f"documents/{checksum}_{document.filename}"
    document.external_modified_time = external_modified_time
    await _index_document_chunks(db, document, content)
    return document
