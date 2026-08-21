"""Armazenamento de objetos (anexos de chamados) compatível com S3 — MinIO
em desenvolvimento local, Amazon S3 em produção, via as mesmas credenciais
(`S3_ENDPOINT_URL`/`S3_BUCKET`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`).

boto3 é síncrono; seguindo o mesmo padrão já usado para Bedrock em
`embeddings.py`, é chamado direto dentro de funções `async def` sem
executor dedicado — aceitável para o volume de anexos de chamados.
"""

import boto3

from app.core.config import settings


def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
    )


async def upload_bytes(key: str, content: bytes, content_type: str) -> None:
    _client().put_object(Bucket=settings.S3_BUCKET, Key=key, Body=content, ContentType=content_type)


async def download_bytes(key: str) -> bytes:
    response = _client().get_object(Bucket=settings.S3_BUCKET, Key=key)
    return response["Body"].read()
