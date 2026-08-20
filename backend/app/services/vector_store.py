import uuid

from qdrant_client import AsyncQdrantClient, models

from app.core.config import settings


class VectorStore:
    def __init__(self) -> None:
        self._client = AsyncQdrantClient(url=settings.QDRANT_URL, api_key=settings.QDRANT_API_KEY)
        self._collection = settings.QDRANT_COLLECTION

    async def ensure_collection(self) -> None:
        exists = await self._client.collection_exists(self._collection)
        if not exists:
            await self._client.create_collection(
                collection_name=self._collection,
                vectors_config=models.VectorParams(size=settings.EMBEDDING_DIM, distance=models.Distance.COSINE),
            )

    async def upsert(self, *, vector: list[float], payload: dict, point_id: str | None = None) -> str:
        pid = point_id or str(uuid.uuid4())
        await self._client.upsert(
            collection_name=self._collection,
            points=[models.PointStruct(id=pid, vector=vector, payload=payload)],
        )
        return pid

    async def search(
        self, *, vector: list[float], top_k: int, department_id: str | None = None
    ) -> list[models.ScoredPoint]:
        query_filter = None
        if department_id:
            query_filter = models.Filter(
                should=[
                    models.FieldCondition(key="department_id", match=models.MatchValue(value=department_id)),
                    models.IsNullCondition(is_null=models.PayloadField(key="department_id")),
                ]
            )
        return await self._client.search(
            collection_name=self._collection, query_vector=vector, limit=top_k, query_filter=query_filter
        )

    async def delete(self, point_id: str) -> None:
        await self._client.delete(
            collection_name=self._collection, points_selector=models.PointIdsList(points=[point_id])
        )


vector_store = VectorStore()
