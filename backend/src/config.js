// =============================================================================
// config.js - Central configuration for the rw-gnr-admin backend
// -----------------------------------------------------------------------------
// 12-factor style: everything organisation-specific comes from environment
// variables. NOTHING in this file may hardcode an organisation name, MSP ID,
// or network endpoint - every organisation on the RecordWeb network runs its
// own instance of this app against its own Fabric identity (see rw-rrn docs,
// "every organisation runs its own CA and issues its own identities").
//
// Two-channel model (test / prod):
// The network (rw-rrn) currently runs the SAME crypto material (identity,
// MSP, peer, orderers) against BOTH channels - `rw-gnr-test` and `rw-gnr`.
// So we only need ONE Fabric identity/connection, but must be able to open
// TWO different Fabric "Network" (channel) handles from that one connection.
// The frontend picks which one to talk to per-request (stateless), the
// backend validates that choice against a fixed allow-list on every request.
// =============================================================================

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const env = (key, fallback) => process.env[key] ?? fallback;
const envBool = (key, fallback) => {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
};

// Fixed allow-list of network keys the frontend is allowed to request.
// This is intentionally NOT organisation-specific - the channel *names* are
// a settled, network-wide convention (see rw-rrn Docs/Config-and-Progress.md).
export const NETWORKS = {
  test: {
    key: 'test',
    label: 'Testnet',
    channelName: env('CHANNEL_NAME_TEST', 'rw-gnr-test'),
  },
  prod: {
    key: 'prod',
    label: 'Production',
    channelName: env('CHANNEL_NAME_PROD', 'rw-gnr'),
  },
};

export function resolveNetworkKey(rawValue) {
  const value = typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : '';
  if (value === 'test' || value === 'prod') return value;
  return null;
}

export const config = {
  // ── Fabric network coordinates ─────────────────────────────────────────
  chaincodeName: env('CHAINCODE_NAME', 'rw-cc-gnr'),

  // gRPC endpoint of the gateway peer this instance connects to.
  peerEndpoint: env('PEER_ENDPOINT', ''),

  // TLS server name the peer certificate is validated against. Must match
  // the CN/SAN in the peer's TLS certificate, even if peerEndpoint points at
  // a tunnelled/port-mapped address.
  peerHostAlias: env('PEER_HOST_ALIAS', ''),

  // MSP ID of the organisation this instance signs transactions as.
  mspId: env('MSP_ID', ''),

  // ── Crypto material paths (this organisation's own identity) ──────────
  peerTlsCaPath: env('PEER_TLS_CA_PATH', ''),
  certPath: env('CERT_PATH', ''),
  keyPath: env('KEY_PATH', ''),

  // ── Production write guard ─────────────────────────────────────────────
  // Safe default: FALSE. Must be explicitly enabled once the operator is
  // ready to register/update namespaces on the production channel. This only
  // gates WRITES (RegisterNamespace, UpdateResolverEndpoint) on the `prod`
  // network; reads (ResolveNamespace, GetMyNamespaces, GetNamespaceHistory)
  // are always allowed on both networks.
  allowProdWrites: envBool('ALLOW_PROD_WRITES', false),

  // ── HTTP server ─────────────────────────────────────────────────────────
  port: Number(env('PORT', '3000')),

  // Static frontend directory.
  frontendDir: env('FRONTEND_DIR', path.resolve(__dirname, '..', '..', 'frontend')),
};

export function assertConfigComplete() {
  const required = ['peerEndpoint', 'peerHostAlias', 'mspId', 'peerTlsCaPath', 'certPath', 'keyPath'];
  const missing = required.filter((k) => !config[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required configuration value(s): ${missing.join(', ')}. ` +
      'Set them via .env (see .env.example).',
    );
  }
}
