resource "kubernetes_deployment" "searmcrm_worker" {
  metadata {
    name      = "${var.searmcrm_app_name}-worker"
    namespace = kubernetes_namespace.searmcrm.metadata.0.name
    labels = {
      app = "${var.searmcrm_app_name}-worker"
    }
  }

  spec {
    replicas = var.searmcrm_worker_replicas
    selector {
      match_labels = {
        app = "${var.searmcrm_app_name}-worker"
      }
    }

    strategy {
      type = "RollingUpdate"
      rolling_update {
        max_surge       = "1"
        max_unavailable = "1"
      }
    }

    template {
      metadata {
        labels = {
          app = "${var.searmcrm_app_name}-worker"
        }
      }

      spec {
        container {
          image   = var.searmcrm_server_image
          name    = var.searmcrm_app_name
          stdin   = true
          tty     = true
          command = ["yarn", "worker:prod"]

          env {
            name  = "SERVER_URL"
            value = var.searmcrm_app_hostname
          }

          env {
            name  = "PG_DATABASE_URL"
            value = "postgres://searm:${var.searmcrm_pgdb_admin_password}@${kubernetes_service.searmcrm_db.metadata.0.name}.${kubernetes_namespace.searmcrm.metadata.0.name}.svc.cluster.local/default"
          }

          env {
            name  = "REDIS_URL"
            value = "redis://${kubernetes_service.searmcrm_redis.metadata.0.name}.${kubernetes_namespace.searmcrm.metadata.0.name}.svc.cluster.local:6379"
          }

          env {
            name  = "DISABLE_DB_MIGRATIONS"
            value = "true" #it already runs on the server
          }

          env {
            name  = "STORAGE_TYPE"
            value = "local"
          }

          env {
            name = "APP_SECRET"
            value_from {
              secret_key_ref {
                name = "tokens"
                key  = "accessToken"
              }
            }
          }

          resources {
            requests = {
              cpu    = "250m"
              memory = "1024Mi"
            }
            limits = {
              cpu    = "1000m"
              memory = "2048Mi"
            }
          }
        }

        dns_policy     = "ClusterFirst"
        restart_policy = "Always"
      }
    }
  }
  depends_on = [
    kubernetes_deployment.searmcrm_db,
    kubernetes_deployment.searmcrm_redis,
    kubernetes_deployment.searmcrm_server,
    kubernetes_secret.searmcrm_tokens,
  ]
}
