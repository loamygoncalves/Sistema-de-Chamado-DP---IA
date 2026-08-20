# Pasta local de conhecimento (dev)

Coloque aqui arquivos `.txt` ou `.pdf` para testar a sincronização automática
localmente com Docker Compose (`LOCAL_KNOWLEDGE_FOLDER=/data/knowledge-base`
no `.env` já aponta pra esta pasta, montada como somente leitura nos
containers `backend` e `worker`).

Em produção, aponte `LOCAL_KNOWLEDGE_FOLDER_HOST_PATH` (variável do shell ou
de um `infra/.env`) para o caminho real da pasta compartilhada da rede —
ver `docs/LOCAL_KNOWLEDGE_SETUP.md`. Os arquivos de teste que você soltar
aqui não são versionados (ver `.gitignore`).
