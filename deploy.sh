#!/usr/bin/env bash
# Despliegue completo del ERP en el proyecto actual de OpenShift.
# Uso:  oc login ...  &&  oc project <tu-proyecto>  &&  ./scripts/deploy.sh
# Opcional: DB_PASSWORD='tu-clave' ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

command -v oc >/dev/null || { echo "ERROR: no se encontró el CLI 'oc'."; exit 1; }
oc whoami >/dev/null 2>&1 || { echo "ERROR: no hay sesión. Ejecuta 'oc login' primero."; exit 1; }
echo ">> Proyecto: $(oc project -q)"

# 1) Secret de la base de datos (solo si no existe; con contraseña aleatoria)
if ! oc get secret erp-db-secret >/dev/null 2>&1; then
  DB_PASSWORD="${DB_PASSWORD:-$(head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)}"
  oc create secret generic erp-db-secret \
    --from-literal=POSTGRESQL_DATABASE=erpdb \
    --from-literal=POSTGRESQL_USER=erpadmin \
    --from-literal=POSTGRESQL_PASSWORD="$DB_PASSWORD"
  oc label secret erp-db-secret app.kubernetes.io/part-of=erp-global --overwrite
  echo ">> Secret creado (contraseña generada, guárdala si la necesitas: $DB_PASSWORD)"
else
  echo ">> Secret erp-db-secret ya existe; se conserva."
fi

# 2) El backend ejecuta su propio sql/init.sql: sincronizarlo con database/init.sql
cp database/init.sql backend/sql/init.sql

# 3) Recursos (PVC, Deployments, Services, Route, ImageStreams, BuildConfigs)
oc apply -f openshift/erp-completo-openshift.yaml

# 4) Compilar las imágenes con el código real (esperar a que terminen)
oc start-build erp-backend-api --from-dir=backend  --follow --wait
oc start-build erp-v2-frontend --from-dir=frontend --follow --wait

# 5) Esperar a que todo esté listo
for d in erp-postgres-db erp-backend-api erp-v2-frontend; do
  oc rollout status "deployment/$d" --timeout=300s
done

echo
echo ">> ERP listo: https://$(oc get route erp-v2-route -o jsonpath='{.spec.host}')"
echo ">> Verificar API: oc exec deploy/erp-v2-frontend -- curl -s localhost:8080/api/v1/metrics"
