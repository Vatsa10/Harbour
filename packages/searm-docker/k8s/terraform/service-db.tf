resource "kubernetes_service" "searmcrm_db" {
  metadata {
    name      = "${var.searmcrm_app_name}-db"
    namespace = kubernetes_namespace.searmcrm.metadata.0.name
  }
  spec {
    selector = {
      app = "${var.searmcrm_app_name}-db"
    }
    session_affinity = "ClientIP"
    port {
      port        = 5432
      target_port = 5432
    }

    type = "ClusterIP"
  }
}
