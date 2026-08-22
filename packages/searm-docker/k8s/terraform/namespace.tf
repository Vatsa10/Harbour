resource "kubernetes_namespace" "searmcrm" {
  metadata {
    annotations = {
      name = var.searmcrm_namespace
    }

    name = var.searmcrm_namespace
  }
}
