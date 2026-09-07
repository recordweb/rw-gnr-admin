// =============================================================================
// contract.js - Typed wrapper around the rw-cc-gnr chaincode functions
// -----------------------------------------------------------------------------
// Reflects the production Go contract 1:1:
//
//   GetMyNamespaces()                                  -> []NamespaceRecord
//   ResolveNamespace(namespace)                        -> NamespaceRecord
//   GetNamespaceHistory(namespace)                     -> []HistoryEntry
//   RegisterNamespace(resolverEndpoint)                -> NamespaceRecord
//   UpdateResolverEndpoint(namespace, newResolverEndpoint)
//
// Every function takes a `networkKey` ('test' | 'prod') as its first
// argument, so the caller (routes layer) decides which channel to hit.
//
// Rule: reads = evaluateTransaction (local query, no ledger write),
// writes = submitTransaction (endorsement + ordering + commit).
//
// Chaincode errors: the production chaincode raises structured
// `ContractError` values with a stable `ErrorCode` (e.g.
// INVALID_RESOLVER_ENDPOINT, NAMESPACE_ALREADY_EXISTS,
// UNAUTHORIZED_REGISTRAR, NAMESPACE_NOT_FOUND, LEDGER_READ_FAILED). The
// fabric-gateway Node SDK surfaces chaincode-side errors as a gRPC error
// whose `.message` contains the Go error text, and (depending on shim
// version) may include structured `.details`. We defensively try several
// extraction strategies and always fall back to a generic UNKNOWN_ERROR
// code so the frontend never has to deal with `undefined`.
// =============================================================================

import { getContractFor } from './gatewayClient.js';

const utf8 = new TextDecoder('utf-8');

function parseJson(bytes) {
  const text = utf8.decode(bytes).trim();
  if (text.length === 0) {
    return null;
  }
  return JSON.parse(text);
}

// Known error codes from the rw-cc-gnr chaincode (as specified in its
// public contract). Kept as a reference list for validation/logging; the
// extractor below does not hard-restrict to this list because the
// chaincode may introduce new codes without an admin-app release.
export const KNOWN_ERROR_CODES = [
  'INVALID_RESOLVER_ENDPOINT',
  'NAMESPACE_ALREADY_EXISTS',
  'UNAUTHORIZED_REGISTRAR',
  'NAMESPACE_NOT_FOUND',
  'LEDGER_READ_FAILED',
];

// -----------------------------------------------------------------------------
// Wraps a chaincode-originating error into a normalised shape:
//   { errorCode: string, message: string, cause: unknown }
// Extraction order:
//   1. Structured gRPC error details carrying a JSON payload with `ErrorCode`.
//   2. A recognisable ALL_CAPS_WITH_UNDERSCORES token in the message text.
//   3. Fallback: 'UNKNOWN_ERROR' with the raw message preserved.
// -----------------------------------------------------------------------------
export function normaliseChaincodeError(err) {
  const rawMessage = err?.message ?? String(err ?? 'unknown error');

  for (const detail of err?.details ?? []) {
    const text = detail?.message ?? '';
    try {
      const parsed = JSON.parse(text);
      if (parsed?.ErrorCode || parsed?.errorCode) {
        return {
          errorCode: parsed.ErrorCode ?? parsed.errorCode,
          message: parsed.Message ?? parsed.message ?? rawMessage,
          cause: err,
        };
      }
    } catch {
      // detail.message wasn't JSON - fall through to text scanning below.
    }
  }

  const codeMatch = rawMessage.match(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/);
  if (codeMatch) {
    return { errorCode: codeMatch[1], message: rawMessage, cause: err };
  }

  return { errorCode: 'UNKNOWN_ERROR', message: rawMessage, cause: err };
}

// ── Reads ────────────────────────────────────────────────────────────────────

// GetMyNamespaces() -> namespaces registered by THIS instance's own MSP
// identity. No parameters - the chaincode derives the caller from
// ctx.GetClientIdentity().GetMSPID().
export async function listMyNamespaces(networkKey) {
  const bytes = await getContractFor(networkKey).evaluateTransaction('GetMyNamespaces');
  return parseJson(bytes) ?? [];
}

// ResolveNamespace(namespace) -> single NamespaceRecord. Publicly readable.
export async function resolveNamespace(networkKey, namespace) {
  const bytes = await getContractFor(networkKey).evaluateTransaction('ResolveNamespace', namespace);
  return parseJson(bytes);
}

// GetNamespaceHistory(namespace) -> array of HistoryEntry.
export async function getNamespaceHistory(networkKey, namespace) {
  const bytes = await getContractFor(networkKey).evaluateTransaction('GetNamespaceHistory', namespace);
  return parseJson(bytes) ?? [];
}

// ── Writes ───────────────────────────────────────────────────────────────────

// RegisterNamespace(resolverEndpoint) -> NamespaceRecord (namespace is
// assigned by the chaincode, derived deterministically from the tx ID, and
// returned in the record - it is NOT a caller-supplied argument anymore).
export async function registerNamespace(networkKey, resolverEndpoint) {
  const result = await getContractFor(networkKey).submitAsync('RegisterNamespace', {
    arguments: [resolverEndpoint],
  });
  const bytes = await result.getResult();
  return parseJson(bytes);
}

// UpdateResolverEndpoint(namespace, newResolverEndpoint). Authorization is
// enforced chaincode-side against the real MSP identity - no callerMSP
// argument from the app anymore.
export async function updateResolverEndpoint(networkKey, namespace, newResolverEndpoint) {
  await getContractFor(networkKey).submitTransaction(
    'UpdateResolverEndpoint',
    namespace,
    newResolverEndpoint,
  );
}
