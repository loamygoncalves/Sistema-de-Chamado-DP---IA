import hashlib
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import DocumentType, KnowledgeSourceType
from app.models.knowledge import FAQ, Document, KnowledgeArticle
from app.services.embeddings import embedding_service
from app.services.ingestion_service import extract_chunks
from app.services.vector_store import vector_store


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


async def ingest_document(
    db: AsyncSession, *, filename: str, file_type: DocumentType, content: bytes, department_id: uuid.UUID | None, uploaded_by: uuid.UUID
) -> Document:
    checksum = hashlib.sha256(content).hexdigest()
    document = Document(
        filename=filename,
        file_type=file_type,
        department_id=department_id,
        storage_path=f"documents/{checksum}_{filename}",
        checksum=checksum,
        uploaded_by=uploaded_by,
    )
    db.add(document)
    await db.flush()

    chunks = extract_chunks(file_type.value, content)
    for index, chunk in enumerate(chunks):
        vector = await embedding_service.embed_one(chunk["text"])
        await vector_store.upsert(
            vector=vector,
            payload={
                "source_id": str(document.id),
                "source_type": "documento",
                "title": f"{filename} ({chunk['metadata']})",
                "text": chunk["text"],
                "department_id": str(department_id) if department_id else None,
            },
        )

    from datetime import datetime, timezone

    document.chunk_count = len(chunks)
    document.indexed_at = datetime.now(timezone.utc)
    await db.flush()
    return document
