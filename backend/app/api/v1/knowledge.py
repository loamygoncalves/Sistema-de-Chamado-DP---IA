import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_admin, require_analyst, require_employee
from app.db.session import get_db
from app.models.enums import DocumentType
from app.models.knowledge import FAQ, Document, KnowledgeArticle
from app.models.user import User
from app.schemas.knowledge import ArticleCreate, ArticleRead, DocumentRead, FAQCreate, FAQRead, LocalSyncResult
from app.services import knowledge_service, local_folder_sync_service
from app.services.local_folder_sync_service import LocalSyncNotConfigured

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


@router.get("/articles", response_model=list[ArticleRead])
async def list_articles(analyst: User = Depends(require_analyst), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(KnowledgeArticle).order_by(KnowledgeArticle.created_at.desc()))
    return result.scalars().all()


@router.post("/articles", response_model=ArticleRead)
async def create_article(payload: ArticleCreate, analyst: User = Depends(require_analyst), db: AsyncSession = Depends(get_db)):
    article = await knowledge_service.create_manual_article(
        db, title=payload.title, content=payload.content, department_id=payload.department_id, tags=payload.tags, created_by=analyst.id
    )
    await db.commit()
    await db.refresh(article)
    return article


@router.get("/faqs", response_model=list[FAQRead])
async def list_faqs(user: User = Depends(require_employee), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FAQ).where(FAQ.is_active.is_(True)).order_by(FAQ.created_at.desc()))
    return result.scalars().all()


@router.post("/faqs", response_model=FAQRead)
async def create_faq(payload: FAQCreate, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    faq = await knowledge_service.create_faq(db, question=payload.question, answer=payload.answer, department_id=payload.department_id)
    await db.commit()
    await db.refresh(faq)
    return faq


@router.post("/documents", response_model=DocumentRead)
async def upload_document(
    file: UploadFile,
    department_id: uuid.UUID | None = None,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    extension = (file.filename or "").rsplit(".", 1)[-1].lower()
    try:
        file_type = DocumentType(extension)
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Formato não suportado. Use PDF, DOCX, XLSX, CSV, PPTX ou TXT."
        ) from exc

    content = await file.read()
    document = await knowledge_service.ingest_document(
        db, filename=file.filename, file_type=file_type, content=content, department_id=department_id, uploaded_by=admin.id
    )
    await db.commit()
    await db.refresh(document)
    return document


@router.get("/documents/{document_id}", response_model=DocumentRead)
async def get_document(document_id: uuid.UUID, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    document = await db.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Documento não encontrado")
    return document


@router.post("/documents/sync-local", response_model=LocalSyncResult)
async def sync_local_documents(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Dispara sob demanda a sincronização com a pasta local/de rede
    configurada (`LOCAL_KNOWLEDGE_FOLDER`). A mesma sincronização também roda
    automaticamente no início de cada resposta da IA — este endpoint serve
    para conferir o resultado sem precisar fazer uma pergunta no chat."""
    try:
        result = await local_folder_sync_service.sync_folder(db)
    except LocalSyncNotConfigured as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await db.commit()
    return LocalSyncResult(
        created=result.created,
        updated=result.updated,
        skipped_unchanged=result.skipped_unchanged,
        skipped_unsupported=result.skipped_unsupported,
        errors=result.errors,
    )
