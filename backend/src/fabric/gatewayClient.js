// =============================================================================
// gatewayClient.js - Fabric Gateway connection (singleton) + per-network
// Contract handles
// -----------------------------------------------------------------------------
// One organisation identity per running instance (X.509 cert + private key +
// MSP ID), one gRPC channel to the gateway peer. That connection is expensive
// to set up (TLS handshake) and is cached as a singleton, exactly as in the
// PoC. What's new: this identity can address TWO different Fabric channels
// ("Network" objects) - `rw-gnr-test` and `rw-gnr` - because this network's
// peer/orderer nodes serve both channels with the same crypto material. We
// therefore cache one Contract handle PER network key, not just one.
// =============================================================================

import { readFileSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { connect, hash, signers } from '@hyperledger/fabric-gateway';
import * as grpc from '@grpc/grpc-js';
import { credentials } from '@grpc/grpc-js';
import * as crypto from 'node:crypto';
import { config, NETWORKS } from '../config.js';

let gateway;
let grpcClient;
const contractCache = new Map(); // networkKey -> Contract

function readPrivateKeyPem(keyPath) {
  const stat = statSync(keyPath);
  if (stat.isDirectory()) {
    const files = readdirSync(keyPath);
    if (files.length === 0) {
      throw new Error(`Keystore directory is empty: ${keyPath}`);
    }
    return readFileSync(path.join(keyPath, files[0]));
  }
  return readFileSync(keyPath);
}

function newGrpcConnection() {
  const tlsRootCert = readFileSync(config.peerTlsCaPath);
  const tlsCredentials = credentials.createSsl(tlsRootCert);

  return new grpc.Client(config.peerEndpoint, tlsCredentials, {
    'grpc.ssl_target_name_override': config.peerHostAlias,
  });
}

function newIdentity() {
  const credentialsPem = readFileSync(config.certPath);
  return { mspId: config.mspId, credentials: credentialsPem };
}

function newSigner() {
  const privateKeyPem = readPrivateKeyPem(config.keyPath);
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  return signers.newPrivateKeySigner(privateKey);
}

export function getGateway() {
  if (gateway) {
    return gateway;
  }

  grpcClient = newGrpcConnection();

  gateway = connect({
    client: grpcClient,
    identity: newIdentity(),
    signer: newSigner(),
    hash: hash.sha256,
    evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
    endorseOptions: () => ({ deadline: Date.now() + 15000 }),
    submitOptions: () => ({ deadline: Date.now() + 5000 }),
    commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
  });

  return gateway;
}

// -----------------------------------------------------------------------------
// Get the Contract handle for a given logical network key ('test' | 'prod').
// Reuses the single cached Gateway connection; only the Network (= channel)
// and Contract lookups differ, and those are cheap (no new TLS handshake).
// -----------------------------------------------------------------------------
export function getContractFor(networkKey) {
  const net = NETWORKS[networkKey];
  if (!net) {
    throw new Error(`Unknown network key: ${networkKey}`);
  }

  if (contractCache.has(networkKey)) {
    return contractCache.get(networkKey);
  }

  const network = getGateway().getNetwork(net.channelName);
  const contract = network.getContract(config.chaincodeName);
  contractCache.set(networkKey, contract);
  return contract;
}

export function closeGateway() {
  gateway?.close();
  grpcClient?.close();
  gateway = undefined;
  grpcClient = undefined;
  contractCache.clear();
}
