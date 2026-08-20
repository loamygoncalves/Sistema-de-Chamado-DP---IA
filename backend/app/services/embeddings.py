import json

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
        if self._provider == "bedrock":
            return [await self._embed_one_bedrock(text) for text in texts]
        raise ValueError(f"Provedor de embeddings desconhecido: {self._provider}")

    async def _embed_one_bedrock(self, text: str) -> list[float]:
        # Amazon Titan Embeddings — mesma role IAM usada para o Bedrock LLM,
        # sem chave de API separada. boto3 não é assíncrono; para o volume de
        # um chat interno isso não é um gargalo real.
        import boto3

        client = boto3.client("bedrock-runtime", region_name=settings.AWS_REGION)
        response = client.invoke_model(
            modelId=settings.BEDROCK_EMBEDDING_MODEL_ID,
            body=json.dumps({"inputText": text}),
        )
        payload = json.loads(response["body"].read())
        return payload["embedding"]

    async def embed_one(self, text: str) -> list[float]:
        return (await self.embed([text]))[0]


embedding_service = EmbeddingService()
