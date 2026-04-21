const { withNativeFederation } = require('@angular-architects/native-federation/config');
const { sharedConfig } = require('../../shared-federation.config');

module.exports = withNativeFederation({
  name: 'seis-mfe-publicador-facturas',

  exposes: {
    './PublicadorFacturasRoutingModule': 'projects/seis-mfe-publicador-facturas/src/app/publicador-facturas/publicador-facturas-routing.module.ts',
  },

  shared: sharedConfig,

  skip: [
    'rxjs/ajax',
    'rxjs/fetch',
    'rxjs/testing',
    'rxjs/webSocket',
  ]
});
