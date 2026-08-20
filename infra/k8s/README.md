# Kubernetes — BEEP AI Service Desk

Aplicar na ordem (ou usar `kubectl apply -f infra/k8s/` — os nomes numerados já
garantem a ordem correta de criação):

```bash
kubectl apply -f infra/k8s/00-namespace.yaml
kubectl apply -f infra/k8s/01-configmap.yaml
# Preencha infra/k8s/02-secrets.example.yaml com valores reais (via vault/CI) e aplique como Secret real:
kubectl apply -f infra/k8s/02-secrets.example.yaml
kubectl apply -f infra/k8s/10-postgres.yaml
kubectl apply -f infra/k8s/11-redis.yaml
kubectl apply -f infra/k8s/12-qdrant.yaml
kubectl apply -f infra/k8s/20-migrate-job.yaml
kubectl wait --for=condition=complete job/beep-backend-migrate -n beep-ai-service-desk --timeout=300s
kubectl apply -f infra/k8s/21-backend.yaml
kubectl apply -f infra/k8s/22-worker.yaml
kubectl apply -f infra/k8s/23-frontend.yaml
kubectl apply -f infra/k8s/30-ingress.yaml
```

Requisitos do cluster: `ingress-nginx`, `cert-manager` (ou equivalente interno) com um
`ClusterIssuer` chamado `letsencrypt-internal-ca`, e uma `StorageClass` padrão para os
`PersistentVolumeClaim` do PostgreSQL/Redis/Qdrant.

Nunca commitar `02-secrets.example.yaml` com valores reais — trate-o como modelo; os
valores reais devem vir do pipeline de CI/CD (GitHub Actions + vault) ou de
`kubectl create secret` executado manualmente por um operador autorizado.
