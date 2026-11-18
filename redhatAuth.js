import Keycloak from 'keycloak-js';

const env = window._env_ || {};

const keycloak = new Keycloak({
  url: env.REACT_APP_RHSSO_URL || 'https://sso.empresa-global.com/auth',
  realm: env.REACT_APP_RHSSO_REALM || 'erp-international',
  clientId: env.REACT_APP_RHSSO_CLIENT_ID || 'erp-react-web'
});

export default keycloak;
