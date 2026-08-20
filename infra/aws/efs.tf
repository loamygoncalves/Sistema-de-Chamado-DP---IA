resource "aws_efs_file_system" "main" {
  creation_token   = "${local.name}-efs"
  encrypted        = true
  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"

  tags = { Name = "${local.name}-efs" }
}

resource "aws_efs_mount_target" "main" {
  count           = length(aws_subnet.private)
  file_system_id  = aws_efs_file_system.main.id
  subnet_id       = aws_subnet.private[count.index].id
  security_groups = [aws_security_group.efs.id]
}

# Pasta de conhecimento — lida pelo backend/worker (local_folder_sync_service).
# Preencha com os arquivos .txt/.pdf via SFTP/rsync/console do EFS depois de
# criado (ver docs/AWS_DEPLOYMENT.md).
resource "aws_efs_access_point" "knowledge_base" {
  file_system_id = aws_efs_file_system.main.id

  posix_user {
    uid = 1000
    gid = 1000
  }

  root_directory {
    path = "/knowledge-base"
    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "755"
    }
  }

  tags = { Name = "${local.name}-knowledge-base" }
}

# Armazenamento persistente do Qdrant — sem isso os embeddings seriam
# perdidos toda vez que a task do Fargate reiniciar.
resource "aws_efs_access_point" "qdrant_storage" {
  file_system_id = aws_efs_file_system.main.id

  posix_user {
    uid = 1000
    gid = 1000
  }

  root_directory {
    path = "/qdrant-storage"
    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "755"
    }
  }

  tags = { Name = "${local.name}-qdrant-storage" }
}
