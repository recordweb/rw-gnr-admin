# rw-gnr-admin

Generic admin web application for the **RecordWeb Global Namespace Registry** chaincode ([`rw-cc-gnr`](https://github.com/recordweb/rw-cc-gnr)), running on the Hyperledger Fabric channels `rw-gnr` (production) and `rw-gnr-test` (testnet), operated in the network repository [`recordweb/rw-rrn`](https://github.com/recordweb/rw-rrn).

Talks to the Fabric peer via the `@hyperledger/fabric-gateway` Node.js SDK (not the peer CLI), and serves a small dependency-free vanilla frontend (no build step).

```
rw-gnr-admin/
├── backend/              # Express server + Fabric Gateway client + REST API
│   ├── Dockerfile
│   ├── .env.example
│   └── src/
│       ├── config.js
│       ├── logger.js
│       ├── server.js
│       ├── fabric/
│       │   ├── gatewayClient.js
│       │   └── contract.js
│       └── routes/
│           └── namespaces.js
└── frontend/              # static UI (HTML/CSS/JS, no build step)
    ├── index.html
    ├── css/style.css
    └── js/
        ├── api.js
        └── dashboard.js
```

## Design principles

- **One organisation, one identity, one instance.** Every organisation on the RecordWeb network runs its own Fabric CA and issues its own identities (see `rw-rrn` docs). Consistently, `rw-gnr-admin` holds exactly **one** Fabric identity (X.509 certificate + private key + MSP ID) per running instance, configured entirely via environment variables. There is no login screen and no in-app identity/wallet switcher - "who you are" is whatever identity this deployment was configured with. If an organisation needs multiple people to act under distinct personal identities, that organisation runs its own additional deployment.
- **No organisation-specific defaults in code.** `config.js` has no fallback values referring to any concrete organisation, MSP, or peer hostname - every such value must come from `.env`. Missing required values make the server refuse to start (fail fast, not fail confusingly later).
- **Two channels, one connection.** `rw-gnr` (production) and `rw-gnr-test` (testnet) are served by the same peer/orderer nodes with the same crypto material in this network, so the backend keeps a single cached Fabric Gateway connection and opens two `Network` (channel) handles from it. The frontend lets the user pick which one to talk to via a session-scoped radio button (default: **Testnet**, for safety); the choice is sent statelessly as a `network` query parameter on every request and validated server-side against a fixed allow-list on every call.
- **Production write guard.** Setting `ALLOW_PROD_WRITES=false` (the default) disables `RegisterNamespace`/`UpdateResolverEndpoint` against the `rw-gnr` channel with a `403 PROD_WRITES_DISABLED` response, enforced in the routes layer *before* any Fabric interaction is attempted. Reads (`ResolveNamespace`, `GetMyNamespaces`, `GetNamespaceHistory`) are always allowed on both channels regardless of this setting. This is a deliberate safety net while the app/network is still being hardened - flip it to `true` only when you are ready to register namespaces on the production ledger.
- **Namespace is chaincode-assigned, not caller-supplied.** `RegisterNamespace` takes only a `resolverEndpoint`; the resulting `namespace` is derived deterministically inside the chaincode from the transaction ID and returned in the response. The UI shows it prominently in a dedicated result dialog right after registration - that is the only moment it is surfaced.
- **Structured chaincode errors.** The chaincode raises `ContractError` values with a stable `ErrorCode` (`INVALID_RESOLVER_ENDPOINT`, `NAMESPACE_ALREADY_EXISTS`, `UNAUTHORIZED_REGISTRAR`, `NAMESPACE_NOT_FOUND`, `LEDGER_READ_FAILED`, ...). The backend extracts these codes defensively (structured gRPC details first, text-pattern fallback second, generic `UNKNOWN_ERROR` last resort) and passes them through to the frontend as `{ errorCode, message }`, so the UI shows specific, actionable messages instead of a generic "transaction failed".
- **Scope boundary.** This registry chaincode - and therefore this app - never stores DID documents, Records, Record content, or access-control decisions; only namespace-to-resolver routing metadata. Do not extend this app to blur that boundary.

## Running locally (development)

Requires Node >= 18 and network access to a Fabric gateway peer that already has `rw-cc-gnr` deployed on `rw-gnr-test` (and/or `rw-gnr`).

```bash
cd backend
cp .env.example .env
# edit .env: fill in your organisation's peer endpoint, MSP ID, and crypto
# material paths (see comments in .env.example)
npm install
npm run start        # or: npm run dev  (auto-restart on change)
```

The UI is then reachable at <http://localhost:3000/> (health check: <http://localhost:3000/api/health>).

## Running via Docker Compose

`rw-gnr-admin` is meant to be added as a service to your organisation's existing Fabric network Docker Compose project (in `rw-rrn`), so it joins the same Docker network as the peer container(s) and can resolve the peer hostname via Docker DNS. See `docker-compose.snippet.yml` in this repo for a ready-to-adapt service definition, and `backend/Dockerfile` for the image build (build context must be the repo root, so `frontend/` is included).

```bash
# from wherever your organisation's compose project lives, after pasting/
# adapting the service snippet:
docker compose build rw-gnr-admin
docker compose up -d rw-gnr-admin
docker compose logs -f rw-gnr-admin
```

## Environment variables

See `backend/.env.example` for the full annotated template. Summary:

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port of the server | `3000` |
| `CHAINCODE_NAME` | Chaincode name as deployed | `rw-cc-gnr` |
| `CHANNEL_NAME_TEST` | Testnet channel name | `rw-gnr-test` |
| `CHANNEL_NAME_PROD` | Production channel name | `rw-gnr` |
| `PEER_ENDPOINT` | gRPC address of your organisation's gateway peer | *(required)* |
| `PEER_HOST_ALIAS` | TLS server name (peer certificate CN/SAN) | *(required)* |
| `MSP_ID` | Your organisation's MSP ID | *(required)* |
| `PEER_TLS_CA_PATH` | Peer's TLS CA certificate | *(required)* |
| `CERT_PATH` | X.509 certificate (signcert) of this instance's identity | *(required)* |
| `KEY_PATH` | Private key (file or keystore directory) | *(required)* |
| `ALLOW_PROD_WRITES` | Enable writes against the production channel | `false` |
| `FRONTEND_DIR` | Directory of static frontend assets | `../frontend` |

## REST API

All namespace endpoints require a `network=test|prod` query parameter.

| Method | Path | Body | Notes |
|---|---|---|---|
| `GET` | `/api/config` | - | MSP ID, chaincode name, `allowProdWrites`, available networks |
| `GET` | `/api/health` | - | Evaluates `GetMyNamespaces` against `test` |
| `GET` | `/api/namespaces` | - | `GetMyNamespaces()` - namespaces registered by this instance's own identity |
| `GET` | `/api/namespaces/:namespace` | - | `ResolveNamespace(namespace)` - publicly readable |
| `GET` | `/api/namespaces/:namespace/history` | - | `GetNamespaceHistory(namespace)` |
| `POST` | `/api/namespaces` | `{ resolverEndpoint }` | `RegisterNamespace(resolverEndpoint)`; returns the assigned `NamespaceRecord` |
| `PUT` | `/api/namespaces/:namespace` | `{ resolverEndpoint }` | `UpdateResolverEndpoint(namespace, resolverEndpoint)` |

Error responses have the shape `{ errorCode, message }`.

## Relationship to the PoC (`root-resolver-testnet`)

This app is an adaptation of the admin app prototyped in `recordweb/root-resolver-testnet` (`admin-app/`), migrated from the retired testnet chaincode API (arbitrary caller-supplied identity string, caller-supplied namespace, unrestricted `GetAllNamespaces`) to the hardened production `rw-cc-gnr` API described above. It is intended as a reference implementation for other RecordWeb admin tooling.
