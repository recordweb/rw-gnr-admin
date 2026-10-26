// =============================================================================
// server.js - Express entry point for the rw-gnr-admin backend
// -----------------------------------------------------------------------------
// Serves the REST API, the static frontend, and a health check that
// exercises a real (lightweight) read against the Fabric Gateway.
// =============================================================================

import express from 'express';
import { config, assertConfigComplete, NETWORKS } from './config.js';
import { namespacesRouter } from './routes/namespaces.js';
import { listMyNamespaces } from './fabric/contract.js';
import { closeGateway } from './fabric/gatewayClient.js';
import { logger } from './logger.js';

import { requireAdmin } from './auth/adminGuard.js';


try {
  assertConfigComplete();
} catch (err) {
  logger.error('Configuration incomplete - refusing to start', { error: err.message });
  process.exit(1);
}

const app = express();

app.use(express.json());

// Öffentlich: nur Status, keine Details
app.get('/api/health', async (_req, res) => {
  try {
    await listMyNamespaces('test');
    res.json({ status: 'ok' });
  } catch (err) {
    logger.error('Health check failed', { error: err?.message });
    res.status(503).json({ status: 'error' });
  }
});

app.use(requireAdmin);

app.use('/api/namespaces', namespacesRouter);

// Small config-introspection endpoint for the frontend (UX only - the
// authoritative enforcement of ALLOW_PROD_WRITES lives in the routes layer,
// not here). Lets the UI grey out / annotate the "Production" option instead
// of letting the user discover the 403 only after submitting.
app.get('/api/config', (_req, res) => {
  res.json({
    mspId: config.mspId,
    chaincodeName: config.chaincodeName,
    allowProdWrites: config.allowProdWrites,
    networks: Object.values(NETWORKS).map(({ key, label }) => ({ key, label })),
  });
});

app.use(express.static(config.frontendDir));

const server = app.listen(config.port, () => {
  logger.info('rw-gnr-admin backend started', {
    port: config.port,
    chaincode: config.chaincodeName,
    mspId: config.mspId,
    peerEndpoint: config.peerEndpoint,
    allowProdWrites: config.allowProdWrites,
  });
});

function shutdown() {
  logger.info('Shutting down rw-gnr-admin backend');
  server.close(() => {
    closeGateway();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
