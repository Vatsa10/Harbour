resource "kubernetes_service" "searmcrm_server" {
  metadata {
    name      = "${var.searmcrm_app_name}-server"
    namespace = kubernetes_namespace.searmcrm.metadata.0.name
  }
  spec {
    selector = {
      app = "${var.searmcrm_app_name}-server"
    }
    session_affinity = "ClientIP"
    port {
      name        = "http-tcp"
      port        = 3000
      target_port = 3000
    }

    type = "ClusterIP"
  }
}
