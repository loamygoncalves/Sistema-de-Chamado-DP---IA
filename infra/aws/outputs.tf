output "alb_dns_name" {
  value       = aws_lb.main.dns_name
  description = "Aponte seu domínio (registro A/ALIAS) para este endereço, ou acesse direto por aqui se ainda não tiver domain_name configurado."
}

output "app_url" {
  value = local.use_https ? "https://${var.domain_name}" : "http://${aws_lb.main.dns_name}"
}

output "ecr_backend_repository_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "ecr_worker_repository_url" {
  value = aws_ecr_repository.worker.repository_url
}

output "ecr_frontend_repository_url" {
  value = aws_ecr_repository.frontend.repository_url
}

output "rds_endpoint" {
  value     = aws_db_instance.main.address
  sensitive = false
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "migrate_task_definition_arn" {
  value       = aws_ecs_task_definition.migrate.arn
  description = "Use com `aws ecs run-task` para rodar as migrações do banco a cada deploy."
}

output "migrate_network_configuration" {
  description = "Cole em `aws ecs run-task --network-configuration` ao rodar a task de migração manualmente."
  value = {
    awsvpcConfiguration = {
      subnets        = aws_subnet.private[*].id
      securityGroups = [aws_security_group.ecs_tasks.id]
      assignPublicIp = "DISABLED"
    }
  }
}

output "secrets_manager_secret_arn" {
  value = aws_secretsmanager_secret.app.arn
}

output "efs_file_system_id" {
  value       = aws_efs_file_system.main.id
  description = "Use para copiar os arquivos .txt/.pdf da base de conhecimento (via um cliente NFS ou o DataSync)."
}
