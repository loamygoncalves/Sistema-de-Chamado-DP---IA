from app.core.config import settings


class EmbeddingService:
    """Wrapper fino sobre o provedor de embeddings, mantendo o resto do RAG agnóstico."""

    def __init__(self) -> None:
        self._provider = settings.EMBEDDING_PROVIDER
        self._model = settings.EMBEDDING_MODEL

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if self._provider == "openai":
            from openai import AsyncOpenAI

            client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
            response = await client.embeddings.create(model=self._model, input=texts)
            return [item.embedding for item in response.data]
        raise ValueError(f"Provedor de embeddings desconhecido: {self._provider}")

    async def embed_one(self, text: str) -> list[float]:
        return (await self.embed([text]))[0]


embedding_service = EmbeddingService()
