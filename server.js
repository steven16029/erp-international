'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');

const PORT = parseInt(process.env.PORT || '8080', 10);
const ENFORCE_RHSSO = process.env.ENFORCE_RHSSO === 'true';
const SCHEMA_LOCK_ID = 727274; // advisory lock: evita que 2 réplicas creen el esquema a la vez
const REGION_RE = /^[A-Z]{2,10}$/;

// ---------------------------------------------------------------- PostgreSQL
if (!process.env.DB_PASSWORD) {
  console.warn('[WARN] DB_PASSWORD no está definido; la conexión a PostgreSQL probablemente falle.');
}

const pool = new Pool({
  host: process.env.DB_HOST || 'erp-postgres-svc',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'erpdb',
  user: process.env.DB_USER || 'erpadmin',
  password: process.env.DB_PASSWORD,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000
});

// Sin este handler, un reinicio de PostgreSQL tumbaría todo el proceso Node
pool.on('error', (err) => console.error('[pg] error en conexión inactiva:', err.message));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let schemaReady = false;

async function initSchema(retries = 40, delayMs = 5000) {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'init.sql'), 'utf8');

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    let client;
    try {
      client = await pool.connect();
      await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK_ID]);
      try {
        await client.query(sql);
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK_ID]);
      }
      schemaReady = true;
      console.log('[db] Esquema y datos iniciales verificados.');
      return;
    } catch (err) {
      console.error(`[db] Intento ${attempt}/${retries} fallido: ${err.message}`);
      if (client) client.release(true);
      client = null;
      await sleep(delayMs);
    } finally {
      if (client) client.release();
    }
  }
  throw new Error('No fue posible inicializar la base de datos');
}

// ---------------------------------------------------- Red Hat SSO (Keycloak)
let verifyToken = null;

function buildVerifier() {
  const base = (process.env.RHSSO_URL || '').replace(/\/+$/, '');
  const realm = process.env.RHSSO_REALM;
  if (!base || !realm) {
    throw new Error('ENFORCE_RHSSO=true requiere RHSSO_URL y RHSSO_REALM');
  }
  // jose se carga solo cuando se exige autenticación
  const { createRemoteJWKSet, jwtVerify } = require('jose');
  const issuer = `${base}/realms/${realm}`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`));
  return (token) => jwtVerify(token, jwks, { issuer });
}

if (ENFORCE_RHSSO) {
  verifyToken = buildVerifier();
}

// Valida firma, emisor y expiración del JWT emitido por Red Hat SSO
const validateRhSso = async (req, res, next) => {
  if (!ENFORCE_RHSSO) return next();

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token Bearer de Red Hat SSO requerido' });
  }
  try {
    const { payload } = await verifyToken(authHeader.slice(7));
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

// ----------------------------------------------------------------- Express
const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Liveness: solo indica que el proceso responde (no depende de la BD para no provocar reinicios en cascada)
app.get('/livez', (req, res) => res.json({ status: 'UP' }));

// Readiness: el pod recibe tráfico solo si la BD responde y el esquema está listo
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    if (!schemaReady) {
      return res.status(503).json({ status: 'STARTING', database: 'CONNECTED', schema: 'PENDING' });
    }
    return res.json({ status: 'UP', database: 'CONNECTED', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[health]', err.message);
    return res.status(503).json({ status: 'DEGRADED', database: 'DISCONNECTED' });
  }
});

app.get('/api/v1/metrics', validateRhSso, async (req, res) => {
  const region = String(req.headers['x-erp-region'] || req.query.region || 'LATAM').toUpperCase();
  if (!REGION_RE.test(region)) {
    return res.status(400).json({ error: 'Código de región inválido' });
  }

  try {
    const result = await pool.query(
      'SELECT region_code, currency, revenue, orders_count, tax_label, updated_at FROM regional_metrics WHERE region_code = $1',
      [region]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Región ${region} no encontrada` });
    }

    const row = result.rows[0];
    return res.json({
      region: row.region_code,
      currency: row.currency,
      revenue: Number(row.revenue).toLocaleString('en-US'),
      orders: row.orders_count,
      taxRate: row.tax_label,
      updatedAt: row.updated_at
    });
  } catch (err) {
    console.error('[metrics]', err.message);
    return res.status(500).json({ error: 'Error consultando PostgreSQL' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// ------------------------------------------------------------------ Arranque
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`ERP Backend API escuchando en puerto ${PORT} (RHSSO ${ENFORCE_RHSSO ? 'ACTIVO' : 'desactivado'})`);
});

initSchema().catch((err) => {
  console.error('[db] ' + err.message);
  process.exit(1); // OpenShift reinicia el pod
});

function shutdown(signal) {
  console.log(`${signal} recibido, cerrando...`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
