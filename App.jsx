import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import keycloak from './services/redhatAuth';

const REGIONS = {
  LATAM: { currency: 'COP', lang: 'es-CO', label: 'Latinoamérica (Bogotá)' },
  NA: { currency: 'USD', lang: 'en-US', label: 'Norteamérica (New York)' },
  EU: { currency: 'EUR', lang: 'de-DE', label: 'Europa (Frankfurt)' }
};

// Datos de demostración que solo se muestran si el backend no responde
const OFFLINE_DATA = {
  LATAM: { revenue: '5,850,000,000', orders: 412, taxRate: '19% IVA' },
  NA: { revenue: '1,450,000', orders: 342, taxRate: '8.875% Sales Tax' },
  EU: { revenue: '1,320,000', orders: 289, taxRate: '19% MwSt' }
};

const env = window._env_ || {};
const AUTH_ENABLED = env.REACT_APP_AUTH_ENABLED === 'true';
// Ruta relativa: nginx del frontend la reenvía al backend dentro del clúster
const API_BASE_URL = (env.REACT_APP_3SCALE_API_URL || '/api/v1').replace(/\/+$/, '');

const cardStyle = { border: '1px solid #d2d2d2', padding: '1.25rem', borderRadius: '6px', background: '#fafafa' };

export default function App() {
  const [authenticated, setAuthenticated] = useState(!AUTH_ENABLED);
  const [region, setRegion] = useState('LATAM');
  const [financialData, setFinancialData] = useState(null);
  const [connected, setConnected] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Conectando con API...');

  const fetchErpMetrics = useCallback(async (selectedRegion) => {
    try {
      const headers = {
        'X-ERP-Region': selectedRegion,
        'X-ERP-Currency': REGIONS[selectedRegion].currency
      };

      if (AUTH_ENABLED) {
        // Renueva el token si le quedan menos de 30 s; si no se puede, vuelve a iniciar sesión
        await keycloak.updateToken(30).catch(() => keycloak.login());
        if (keycloak.token) headers.Authorization = `Bearer ${keycloak.token}`;
      }

      const response = await axios.get(`${API_BASE_URL}/metrics`, { headers, timeout: 10000 });
      setFinancialData(response.data);
      setConnected(true);
      setStatusMsg('Conectado / PostgreSQL + OpenShift Activo');
    } catch (err) {
      setConnected(false);
      setStatusMsg('Modo Offline (datos de demostración) / Revisa el backend y el ConfigMap');
      setFinancialData(OFFLINE_DATA[selectedRegion]);
    }
  }, []);

  useEffect(() => {
    if (AUTH_ENABLED) {
      keycloak
        .init({ onLoad: 'login-required', checkLoginIframe: false })
        .then((auth) => {
          setAuthenticated(auth);
          if (auth) fetchErpMetrics('LATAM');
        })
        .catch(() => setStatusMsg('Error conectando con Red Hat SSO'));
    } else {
      fetchErpMetrics('LATAM');
    }
  }, [fetchErpMetrics]);

  const handleRegionChange = (e) => {
    const newRegion = e.target.value;
    setRegion(newRegion);
    fetchErpMetrics(newRegion);
  };

  if (!authenticated) {
    return <div style={{ padding: 20 }}>{statusMsg.startsWith('Error') ? statusMsg : 'Autenticando en Red Hat Single Sign-On...'}</div>;
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #ee0000', paddingBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0, color: '#151515' }}>Global ERP Enterprise</h1>
          <small style={{ color: '#6a6e73' }}>Desplegado en Red Hat OpenShift</small>
        </div>
        <div>
          <select value={region} onChange={handleRegionChange} style={{ marginRight: '1rem', padding: '0.5rem', borderRadius: '4px' }}>
            {Object.entries(REGIONS).map(([key, val]) => (
              <option key={key} value={key}>{val.label} - ({val.currency})</option>
            ))}
          </select>
          {AUTH_ENABLED && (
            <>
              <span>Usuario: <strong>{keycloak.tokenParsed?.preferred_username}</strong></span>
              <button onClick={() => keycloak.logout()} style={{ marginLeft: '1rem', padding: '0.4rem 0.8rem' }}>Cerrar Sesión</button>
            </>
          )}
        </div>
      </header>

      <main style={{ marginTop: '2rem' }}>
        <h2>Resumen Operativo - {REGIONS[region].label}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0, color: '#4f5255' }}>Ingresos Consolidados</h3>
            <p style={{ fontSize: '1.6rem', fontWeight: 'bold', margin: '0.5rem 0' }}>
              {financialData?.revenue || '---'} {REGIONS[region].currency}
            </p>
            <small>Impuesto regional: {financialData?.taxRate || 'N/A'}</small>
          </div>
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0, color: '#4f5255' }}>Órdenes Internacionales</h3>
            <p style={{ fontSize: '1.6rem', fontWeight: 'bold', margin: '0.5rem 0' }}>
              {financialData?.orders ?? '---'}
            </p>
            <small>{connected ? 'Sincronizado con PostgreSQL' : 'Datos de demostración (sin conexión)'}</small>
          </div>
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0, color: '#4f5255' }}>Estado Red Hat Gateway</h3>
            <p style={{ color: connected ? '#3e8635' : '#c9190b', fontWeight: 'bold', margin: '0.5rem 0' }}>{statusMsg}</p>
            <small>TLS Edge Termination</small>
          </div>
        </div>
      </main>
    </div>
  );
}
