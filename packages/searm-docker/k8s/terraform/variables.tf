######################
# Required Variables #
######################
variable "searmcrm_pgdb_admin_password" {
  type        = string
  description = "SearmCRM password for postgres database."
  sensitive   = true
}

variable "searmcrm_app_hostname" {
  type        = string
  description = "The protocol, DNS fully qualified hostname, and port used to access SearmCRM in your environment. Ex: https://crm.example.com:443"
}

######################
# Optional Variables #
######################
variable "searmcrm_app_name" {
  type        = string
  default     = "searmcrm"
  description = "A friendly name prefix to use for every component deployed."
}

variable "searmcrm_server_image" {
  type        = string
  default     = "searmcrm/searm:latest"
  description = "SearmCRM server image for the server deployment. This defaults to latest. This value is also used for the workers image."
}

variable "searmcrm_db_image" {
  type        = string
  default     = "searmcrm/searm-postgres-spilo:latest"
  description = "SearmCRM image for database deployment. This defaults to latest."
}

variable "searmcrm_server_replicas" {
  type        = number
  default     = 1
  description = "Number of replicas for the SearmCRM server deployment. This defaults to 1."
}

variable "searmcrm_worker_replicas" {
  type        = number
  default     = 1
  description = "Number of replicas for the SearmCRM worker deployment. This defaults to 1."
}

variable "searmcrm_db_replicas" {
  type        = number
  default     = 1
  description = "Number of replicas for the SearmCRM database deployment. This defaults to 1."
}

variable "searmcrm_server_data_mount_path" {
  type        = string
  default     = "/app/packages/searm-server/.local-storage"
  description = "SearmCRM mount path for servers application data. Defaults to '/app/packages/searm-server/.local-storage'."
}

variable "searmcrm_db_pv_path" {
  type        = string
  default     = ""
  description = "Local path to use to store the physical volume if using local storage on nodes."
}

variable "searmcrm_server_pv_path" {
  type        = string
  default     = ""
  description = "Local path to use to store the physical volume if using local storage on nodes."
}

variable "searmcrm_db_pv_capacity" {
  type        = string
  default     = "10Gi"
  description = "Storage capacity provisioned for database persistent volume."
}

variable "searmcrm_db_pvc_requests" {
  type        = string
  default     = "10Gi"
  description = "Storage capacity reservation for database persistent volume claim."
}

variable "searmcrm_server_pv_capacity" {
  type        = string
  default     = "10Gi"
  description = "Storage capacity provisioned for server persistent volume."
}

variable "searmcrm_server_pvc_requests" {
  type        = string
  default     = "10Gi"
  description = "Storage capacity reservation for server persistent volume claim."
}

variable "searmcrm_namespace" {
  type        = string
  default     = "searmcrm"
  description = "Namespace for all SearmCRM resources"
}

variable "searmcrm_redis_replicas" {
  type        = number
  default     = 1
  description = "Number of replicas for the SearmCRM Redis deployment. This defaults to 1."
}

variable "searmcrm_redis_image" {
  type        = string
  default     = "redis/redis-stack-server:latest"
  description = "SearmCRM image for Redis deployment. This defaults to latest."
}

variable "searmcrm_docker_data_mount_path" {
  type        = string
  default     = "/app/docker-data"
  description = "SearmCRM mount path for servers application data. Defaults to '/app/docker-data'."
}

variable "searmcrm_docker_data_pv_path" {
  type        = string
  default     = ""
  description = "Local path to use to store the physical volume if using local storage on nodes."
}

variable "searmcrm_docker_data_pv_capacity" {
  type        = string
  default     = "100Mi"
  description = "Storage capacity provisioned for server persistent volume."
}

variable "searmcrm_docker_data_pvc_requests" {
  type        = string
  default     = "100Mi"
  description = "Storage capacity reservation for server persistent volume claim."
}
