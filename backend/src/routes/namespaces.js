// =============================================================================
// routes/namespaces.js - REST endpoints for the Global Namespace Registry
// -----------------------------------------------------------------------------
// GET    /api/namespaces?network=test|prod              -> my namespaces
// GET    /api/namespaces/:namespace?network=test|prod    -> single record
// GET    /api/namespaces/:namespace/history?network=...  -> history
// POST   /api/namespaces?network=test|prod               -> register (body: { resolverEndpoint })
// PUT    /api/namespaces/:namespace?network=test|prod     -> update endpoint (body: { resolverEndpoint })
//
// Network selection is stateless: the frontend sends `network` on every
// request (query parameter), the backend validates it against a fixed
// allow-list (`resolveNetworkKey`) on every request - there is no server-side
// session state to keep in sync.
//
// Production write guard: RegisterNamespace/UpdateResolverEndpoint against
// `network=prod` are rejected with 403 PROD_WRITES_DISABLED unless
// ALLOW_PROD_WRITES=true. This check runs BEFORE any Fabric interaction, so a
// disabled instance never even opens the prod channel for a write attempt.
// Reads are never affected by this guard.
// =============================================================================

import { Router } from 'express';
import { config, resolveNetworkKey } from '../config.js';
import {
  listMyNamespaces,
  resolveNamespace,
  getNamespaceHistory,
  registerNamespace,
  updateResolverEndpoint,
  normaliseChaincodeError,
} from '../fabric/contract.js';
import { logger } from '../logger.js';

export const namespacesRouter = Router();

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

function getNetworkKeyOrFail(req, res) {
  const key = resolveNetworkKey(req.query.network);
  if (!key) {
    res.status(400).json({
      errorCode: 'INVALID_NETWORK_PARAMETER',
      message: "Query parameter 'network' must be 'test' or 'prod'.",
    });
    return null;
  }
  return key;
}

function assertProdWritesAllowed(networkKey, req, res) {
  if (networkKey === 'prod' && !config.allowProdWrites) {
    logger.warn('Rejected write attempt against prod (ALLOW_PROD_WRITES=false)', {
      path: req.path,
      method: req.method,
    });
    res.status(403).json({
      errorCode: 'PROD_WRITES_DISABLED',
      message:
        'Write access to the production network is disabled on this instance ' +
        '(ALLOW_PROD_WRITES=false). Reads remain available.',
    });
    return false;
  }
  return true;
}

// Maps a normalised chaincode error ({ errorCode, message }) to an HTTP
// status. Falls back to 500 for anything not explicitly known.
const ERROR_CODE_STATUS = {
  NAMESPACE_NOT_FOUND: 404,
  NAMESPACE_ALREADY_EXISTS: 409,
  UNAUTHORIZED_REGISTRAR: 403,
  INVALID_RESOLVER_ENDPOINT: 400,
  LEDGER_READ_FAILED: 502,
};

function sendChaincodeError(res, err) {
  const { errorCode, message } = normaliseChaincodeError(err);
  const status = ERROR_CODE_STATUS[errorCode] ?? 500;
  logger.error('Chaincode call failed', { errorCode, message });
  res.status(status).json({ errorCode, message });
}

// -----------------------------------------------------------------------------
// GET /api/namespaces - my namespaces on the selected network.
// -----------------------------------------------------------------------------
namespacesRouter.get('/', async (req, res) => {
  const networkKey = getNetworkKeyOrFail(req, res);
  if (!networkKey) return;

  try {
    res.json(await listMyNamespaces(networkKey));
  } catch (err) {
    sendChaincodeError(res, err);
  }
});

// -----------------------------------------------------------------------------
// GET /api/namespaces/:namespace - single record (publicly readable).
// -----------------------------------------------------------------------------
namespacesRouter.get('/:namespace', async (req, res) => {
  const networkKey = getNetworkKeyOrFail(req, res);
  if (!networkKey) return;

  try {
    const record = await resolveNamespace(networkKey, req.params.namespace);
    if (!record) {
      return res.status(404).json({
        errorCode: 'NAMESPACE_NOT_FOUND',
        message: `Namespace '${req.params.namespace}' was not found on network '${networkKey}'.`,
      });
    }
    res.json(record);
  } catch (err) {
    sendChaincodeError(res, err);
  }
});

// -----------------------------------------------------------------------------
// GET /api/namespaces/:namespace/history
// -----------------------------------------------------------------------------
namespacesRouter.get('/:namespace/history', async (req, res) => {
  const networkKey = getNetworkKeyOrFail(req, res);
  if (!networkKey) return;

  try {
    res.json(await getNamespaceHistory(networkKey, req.params.namespace));
  } catch (err) {
    sendChaincodeError(res, err);
  }
});

// -----------------------------------------------------------------------------
// POST /api/namespaces - register a new namespace.
// Body: { resolverEndpoint }. The namespace itself is assigned by the
// chaincode and returned in the response body - it is never a request input.
// -----------------------------------------------------------------------------
namespacesRouter.post('/', async (req, res) => {
  const networkKey = getNetworkKeyOrFail(req, res);
  if (!networkKey) return;
  if (!assertProdWritesAllowed(networkKey, req, res)) return;

  const { resolverEndpoint } = req.body ?? {};

  if (!resolverEndpoint || typeof resolverEndpoint !== 'string') {
    return res.status(400).json({
      errorCode: 'INVALID_RESOLVER_ENDPOINT',
      message: 'resolverEndpoint is required and must be a string.',
    });
  }
  if (!/^https:\/\//i.test(resolverEndpoint.trim())) {
    return res.status(400).json({
      errorCode: 'INVALID_RESOLVER_ENDPOINT',
      message: 'resolverEndpoint must be an absolute HTTPS URL.',
    });
  }

  try {
    const record = await registerNamespace(networkKey, resolverEndpoint.trim());
    logger.info('Namespace registered', { networkKey, namespace: record?.namespace });
    res.status(201).json(record);
  } catch (err) {
    sendChaincodeError(res, err);
  }
});

// -----------------------------------------------------------------------------
// PUT /api/namespaces/:namespace - update resolverEndpoint.
// Body: { resolverEndpoint }. No callerMSP field - authorization is enforced
// chaincode-side against this instance's own Gateway identity.
// -----------------------------------------------------------------------------
namespacesRouter.put('/:namespace', async (req, res) => {
  const networkKey = getNetworkKeyOrFail(req, res);
  if (!networkKey) return;
  if (!assertProdWritesAllowed(networkKey, req, res)) return;

  const { resolverEndpoint } = req.body ?? {};

  if (!resolverEndpoint || typeof resolverEndpoint !== 'string') {
    return res.status(400).json({
      errorCode: 'INVALID_RESOLVER_ENDPOINT',
      message: 'resolverEndpoint is required and must be a string.',
    });
  }
  if (!/^https:\/\//i.test(resolverEndpoint.trim())) {
    return res.status(400).json({
      errorCode: 'INVALID_RESOLVER_ENDPOINT',
      message: 'resolverEndpoint must be an absolute HTTPS URL.',
    });
  }

  try {
    await updateResolverEndpoint(networkKey, req.params.namespace, resolverEndpoint.trim());
    logger.info('Resolver endpoint updated', { networkKey, namespace: req.params.namespace });
    res.json(await resolveNamespace(networkKey, req.params.namespace));
  } catch (err) {
    sendChaincodeError(res, err);
  }
});
