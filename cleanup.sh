#!/usr/bin/env bash
# Elimina el ERP del proyecto actual (incluye nombres de versiones anteriores del manifiesto).
# Por defecto CONSERVA el PVC y el Secret (datos). Usa --all para borrarlo todo.
# Ejecútalo también antes de re-desplegar si ya tenías la versión anterior (cambió la estrategia
# del Deployment de PostgreSQL y apply fallaría).
set -uo pipefail
echo ">> Proyecto: $(oc project -q)"
oc delete deployment erp-postgres-db erp-backend-api erp-v2-frontend --ignore-not-found
oc delete service erp-postgres-svc erp-backend-svc erp-v2-service --ignore-not-found
oc delete route erp-backend-route erp-v2-route --ignore-not-found
oc delete configmap erp-db-init-sql erp-v2-config --ignore-not-found
oc delete bc erp-backend-api erp-v2-frontend --ignore-not-found
oc delete is erp-backend-api erp-v2-frontend --ignore-not-found
oc delete networkpolicy erp-postgres-solo-backend --ignore-not-found
if [[ "${1:-}" == "--all" ]]; then
  oc delete pvc erp-postgres-pvc --ignore-not-found
  oc delete secret erp-db-secret --ignore-not-found
  echo ">> Eliminado TODO, incluidos datos y Secret."
else
  echo ">> PVC y Secret conservados (usa --all para borrarlos)."
fi
