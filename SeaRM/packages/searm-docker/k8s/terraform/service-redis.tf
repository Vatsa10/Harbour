resource "kubernetes_service" "searmcrm_redis" {
  metadata {
    name      = "${var.searmcrm_app_name}-redis"
    namespace = kubernetes_namespace.searmcrm.metadata.0.name
  }
  spec {
    selector = {
      app = "${var.searmcrm_app_name}-redis"
    }
    session_affinity = "ClientIP"
    port {
      port        = 6379
      target_port = 6379
    }

    type = "ClusterIP"
  }
}
