# ERP Internacional para Red Hat OpenShift

Frontend **React** + Backend **Node.js/Express** + **PostgreSQL**, listo para OpenShift (diseñado para el Developer Sandbox: sin Namespace, sin root).

## Arquitectura y conexiones

```
Navegador ──HTTPS──▶ Route erp-v2-route ─▶ Service erp-v2-service ─▶ nginx (frontend)
                                                                        │  /api/*
                                                                        ▼
                                               Service erp-backend-svc ─▶ Node.js (backend)
                                                                        │  DB_HOST/DB_USER/DB_PASSWORD (Secret)
                                                                        ▼
                                               Service erp-postgres-svc ─▶ PostgreSQL (PVC 1Gi)

BuildConfig ─▶ ImageStream ─(trigger)─▶ Deployment   (cada build actualiza el pod solo)
```

- El navegador **solo habla con el frontend**; nginx reenvía `/api/*` al backend dentro del clúster. No hay CORS ni URLs con el nombre de tu proyecto.
- El backend lee las credenciales de BD del Secret `erp-db-secret` y crea la tabla + datos iniciales al arrancar (con reintentos, idempotente).
- La configuración del frontend (`env-config.js`) viene del ConfigMap `erp-v2-config`: se cambia sin recompilar.

## Estructura

| Ruta | Contenido |
|---|---|
| `backend/` | API Express, `Containerfile` (UBI 9), `sql/init.sql` |
| `frontend/` | App React, `nginx.conf`, `Containerfile` (UBI 9 + nginx) |
| `database/init.sql` | Copia de referencia del SQL (`deploy.sh` la sincroniza con `backend/sql/`) |
| `openshift/00-secret.yaml` | Secret con credenciales de PostgreSQL |
| `openshift/erp-completo-openshift.yaml` | PVC, Deployments, Services, Route, ImageStreams, BuildConfigs |
| `openshift/optional/networkpolicy.yaml` | Opcional: solo el backend accede a la BD |
| `scripts/deploy.sh` · `cleanup.sh` | Despliegue automático y limpieza |

## Despliegue (necesitas el CLI `oc` y el proyecto abierto en tu equipo)

```bash
oc login --token=... --server=...     # Copy login command en la consola web
oc project <tu-proyecto>
./scripts/deploy.sh
```

El script crea el Secret (contraseña aleatoria), aplica el manifiesto, compila backend y frontend, espera los rollouts e imprime la URL.

### Paso a paso manual

```bash
oc apply -f openshift/                                   # Secret + todo lo demás (cambia la contraseña antes)
oc start-build erp-backend-api --from-dir=backend  --follow
oc start-build erp-v2-frontend --from-dir=frontend --follow
oc get pods
oc get route erp-v2-route -o jsonpath='{.spec.host}'
```

> La terminal web (`>_`) de OpenShift no tiene tus archivos locales. Usa el `oc` de tu equipo, o sube el proyecto a Git y cambia las BuildConfig a origen Git:
> ```bash
> oc patch bc/erp-backend-api -p '{"spec":{"source":{"type":"Git","binary":null,"git":{"uri":"https://github.com/USUARIO/REPO.git"},"contextDir":"backend"}}}'
> oc patch bc/erp-v2-frontend -p '{"spec":{"source":{"type":"Git","binary":null,"git":{"uri":"https://github.com/USUARIO/REPO.git"},"contextDir":"frontend"}}}'
> oc start-build erp-backend-api --follow && oc start-build erp-v2-frontend --follow
> ```

## Si ya habías desplegado la versión anterior

Ejecuta primero `./scripts/cleanup.sh` (cambió la estrategia del Deployment de PostgreSQL y los nombres de las claves del Secret), luego `./scripts/deploy.sh`.

## Verificación

```bash
oc get pods                                              # todos Running y READY
oc logs deploy/erp-backend-api                           # "[db] Esquema y datos iniciales verificados."
oc exec deploy/erp-v2-frontend -- curl -s localhost:8080/api/v1/metrics -H 'X-ERP-Region: NA'
```

La pantalla debe mostrar **"Conectado / PostgreSQL + OpenShift Activo"** en verde. Si aparece "Modo Offline" en rojo, el frontend no logra hablar con el backend (revisa `oc logs`).

## Red Hat SSO (Keycloak) – opcional

1. Edita `erp-v2-config` (`REACT_APP_AUTH_ENABLED: "true"` + URL, realm y clientId) y reinicia el frontend: `oc rollout restart deploy/erp-v2-frontend`.
2. En el Deployment del backend pon `ENFORCE_RHSSO=true`, `RHSSO_URL` y `RHSSO_REALM`. El backend valida firma, emisor y expiración del JWT contra el JWKS del realm.
3. El cliente `erp-react-web` en Keycloak debe tener como Redirect URI / Web Origin la URL de la Route.

## Desarrollo local

```bash
cd backend  && npm install && DB_HOST=localhost DB_PASSWORD=... npm start   # puerto 8080
cd frontend && npm install && npm start                                     # /api se redirige a :8080
```

## Notas

- Producción: cambia la contraseña de BD, usa más de 1Gi si hace falta y considera `openshift/optional/networkpolicy.yaml`.
- Imagen de BD: `registry.access.redhat.com/rhel9/postgresql-16`. Si tu clúster no puede descargarla, usa `quay.io/sclorg/postgresql-16-c9s:latest`.
