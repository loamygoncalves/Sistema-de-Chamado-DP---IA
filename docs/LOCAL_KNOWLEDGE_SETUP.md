# Configurar a sincronização com a pasta local/de rede

Guia para habilitar a sincronização automática da base de conhecimento com
uma pasta local ou de rede (`.txt`/`.pdf`) — **sem Google Cloud, sem API
externa, sem custo**. O código já lê a pasta sozinho antes de cada resposta
da IA (`app/services/local_folder_sync_service.py`); falta só apontar
`LOCAL_KNOWLEDGE_FOLDER` para o caminho certo e garantir que esse caminho
existe dentro do container/pod.

## 1. Desenvolvimento local (Docker Compose)

1. Descubra o caminho da pasta compartilhada da rede no seu computador (ex.:
   um drive de rede já mapeado/montado, tipo `/mnt/beep-share/sistema-chamado-ia`
   ou `Z:\SISTEMA DE CHAMADO - IA` no Windows via WSL).
2. No `.env` (raiz do projeto) mantenha:
   ```bash
   LOCAL_KNOWLEDGE_FOLDER=/data/knowledge-base
   ```
   Esse é o caminho **dentro do container** — não precisa mudar.
3. Aponte o `docker-compose.yml` para o caminho real no seu host, exportando
   a variável antes de subir os containers (ou colocando num `infra/.env`):
   ```bash
   export LOCAL_KNOWLEDGE_FOLDER_HOST_PATH=/mnt/beep-share/sistema-chamado-ia
   docker compose -f infra/docker-compose.yml up -d --build backend worker
   ```
   Se você não definir `LOCAL_KNOWLEDGE_FOLDER_HOST_PATH`, o compose usa
   `infra/knowledge-base/` por padrão — útil só para testar com alguns
   arquivos de exemplo localmente.
4. A pasta é montada **somente leitura** nos containers `backend` e `worker`
   — o sistema nunca escreve nem apaga nada nela.

## 2. Testar rapidamente

1. Coloque um `.txt` ou `.pdf` de teste na pasta apontada.
2. Faça uma pergunta no chat (`/`, portal do colaborador) cujo assunto esteja
   nesse arquivo — a sincronização roda automaticamente antes da resposta.
3. Ou dispare manualmente, sem precisar perguntar nada, com um usuário admin:
   ```bash
   curl -X POST http://localhost:8000/api/v1/knowledge/documents/sync-local \
     -H "Authorization: Bearer <token-admin>"
   ```
   A resposta traz `{created, updated, skipped_unchanged, skipped_unsupported,
   errors}` com o caminho de cada arquivo processado (relativo à pasta). Se
   `LOCAL_KNOWLEDGE_FOLDER` não estiver configurado ou a pasta não existir,
   retorna `400` explicando o problema.

## 3. Produção (Kubernetes)

A pasta de rede precisa estar acessível pelo cluster. `infra/k8s/13-knowledge-volume.yaml`
já traz um exemplo de `PersistentVolume`/`PersistentVolumeClaim` montado
como somente leitura em `/data/knowledge-base` nos pods `backend` e `worker`:

- Se o servidor de arquivos da Beep fala **NFS**, preencha `server`/`path` no
  arquivo com o endereço real do servidor e o caminho exportado.
- Se for um compartilhamento **Windows/SMB**, troque o bloco `nfs:` por um
  volume via CSI driver de CIFS/SMB (ex.:
  [csi-driver-smb](https://github.com/kubernetes-csi/csi-driver-smb)) —
  consulte a documentação do driver escolhido pelo time de infra para os
  campos exatos (`csi.driver`, `volumeAttributes`, credenciais de acesso ao
  share, se houver).

Depois de preencher, aplique antes do backend/worker:
```bash
kubectl apply -f infra/k8s/13-knowledge-volume.yaml
kubectl apply -f infra/k8s/21-backend.yaml
kubectl apply -f infra/k8s/22-worker.yaml
```

`LOCAL_KNOWLEDGE_FOLDER=/data/knowledge-base` já vem configurado no
`ConfigMap` (`infra/k8s/01-configmap.yaml`) apontando para esse mesmo mount.

## 4. Associar os documentos a um departamento (opcional)

Por padrão, os documentos da pasta ficam disponíveis para a IA
independente de departamento (cobrem vários assuntos, como o Guia do
Colaborador). Se preferir associar tudo da pasta a uma fila específica,
preencha `LOCAL_KNOWLEDGE_DEFAULT_DEPARTMENT_SLUG` (ex.: `folha-de-pagamento`)
no `.env`/ConfigMap.

## Depois de configurado

Basta editar/adicionar o arquivo diretamente na pasta — a próxima resposta
da IA (ou uma chamada manual ao endpoint acima) detecta a mudança pela data
de modificação do arquivo e reingere o conteúdo automaticamente, sem
necessidade de subir nada manualmente pelo painel do sistema.
