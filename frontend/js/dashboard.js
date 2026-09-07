// dashboard.js - dashboard logic: network switch, list, register, edit, history.
import { api } from './api.js';

const NETWORK_KEY = 'rwGnrAdminNetwork';
const DEFAULT_NETWORK = 'test'; // safe default: never default to production.

// ── DOM references ───────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const identityLabelEl = $('identity-label');
const networkSwitchEl = $('network-switch');
const networkOptionProdEl = $('network-option-prod');
const prodWritesBannerEl = $('prod-writes-banner');

const loadingEl = $('loading');
const tableEl = $('namespaces-table');
const bodyEl = $('namespaces-body');
const emptyHintEl = $('empty-hint');
const messageEl = $('message');

const editDialog = $('edit-dialog');
const registerDialog = $('register-dialog');
const resultDialog = $('result-dialog');
const historyDialog = $('history-dialog');

// ── Network state (session-scoped, stateless on the wire) ──────────────────
function getCurrentNetwork() {
  return sessionStorage.getItem(NETWORK_KEY) ?? DEFAULT_NETWORK;
}

function setCurrentNetwork(network) {
  sessionStorage.setItem(NETWORK_KEY, network);
}

function applyNetworkToRadios(network) {
  const input = networkSwitchEl.querySelector(`input[value="${network}"]`);
  if (input) input.checked = true;
}

applyNetworkToRadios(getCurrentNetwork());

networkSwitchEl.addEventListener('change', (event) => {
  if (event.target.name !== 'network') return;
  setCurrentNetwork(event.target.value);
  loadNamespaces();
});

// ── Init: backend config (identity, prod-write guard) ───────────────────────
async function initConfig() {
  try {
    const cfg = await api.getConfig();
    identityLabelEl.textContent = `${cfg.mspId} · ${cfg.chaincodeName}`;

    if (!cfg.allowProdWrites) {
      networkOptionProdEl.classList.add('network-option-restricted');
      networkOptionProdEl.title =
        'Production writes are disabled on this instance (ALLOW_PROD_WRITES=false). Reads still work.';
    }
  } catch (err) {
    identityLabelEl.textContent = 'Identity unavailable';
    showMessage(`Could not load backend configuration: ${err.message}`, 'error');
  }
}

// ── Status messages ──────────────────────────────────────────────────────────
function showMessage(text, kind) {
  messageEl.textContent = text;
  messageEl.className = `message message-${kind}`;
}
function clearMessage() {
  messageEl.className = 'message hidden';
  messageEl.textContent = '';
}

// ── Load & render list ────────────────────────────────────────────────────────
async function loadNamespaces() {
  clearMessage();
  loadingEl.classList.remove('hidden');
  tableEl.classList.add('hidden');
  emptyHintEl.classList.add('hidden');
  prodWritesBannerEl.classList.add('hidden');

  const network = getCurrentNetwork();

  try {
    const records = await api.listNamespaces(network);
    renderTable(records ?? []);
  } catch (err) {
    showMessage(`Failed to load namespaces: ${describeError(err)}`, 'error');
  } finally {
    loadingEl.classList.add('hidden');
  }
}

function renderTable(records) {
  bodyEl.replaceChildren();

  if (records.length === 0) {
    emptyHintEl.classList.remove('hidden');
    tableEl.classList.add('hidden');
    return;
  }

  for (const rec of records) {
    bodyEl.appendChild(buildRow(rec));
  }
  tableEl.classList.remove('hidden');
}

// Row built via DOM API (textContent) - no HTML-injection risk from
// ledger/user data.
function buildRow(rec) {
  const tr = document.createElement('tr');

  appendCell(tr, rec.namespace);
  appendCell(tr, rec.resolverEndpoint);
  appendCell(tr, rec.registeredBy);
  appendCell(tr, rec.registeredAt);

  const actions = document.createElement('td');
  actions.className = 'actions';
  actions.appendChild(makeButton('Edit', 'btn', () => openEditDialog(rec)));
  actions.appendChild(
    makeButton('History', 'btn btn-ghost', () => openHistoryDialog(rec.namespace)),
  );
  tr.appendChild(actions);

  return tr;
}

function appendCell(tr, value) {
  const td = document.createElement('td');
  td.textContent = value ?? '';
  tr.appendChild(td);
}

function makeButton(label, className, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

// ── Client-side validation mirroring the chaincode's HTTPS-only rule ───────
function validateResolverEndpoint(value) {
  const trimmed = value.trim();
  if (!trimmed) return 'Resolver endpoint is required.';
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return 'Resolver endpoint must be a valid absolute URL.';
  }
  if (url.protocol !== 'https:') {
    return 'Resolver endpoint must use HTTPS.';
  }
  return null;
}

// ── Edit (PUT) ────────────────────────────────────────────────────────────────
function openEditDialog(rec) {
  $('edit-namespace').textContent = rec.namespace;
  $('edit-endpoint').value = rec.resolverEndpoint ?? '';
  hideDialogError('edit-error');
  editDialog.dataset.namespace = rec.namespace;
  editDialog.showModal();
}

$('edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const namespace = editDialog.dataset.namespace;
  const resolverEndpoint = $('edit-endpoint').value.trim();

  const validationError = validateResolverEndpoint(resolverEndpoint);
  if (validationError) {
    showDialogError('edit-error', validationError);
    return;
  }

  try {
    await api.updateResolverEndpoint(getCurrentNetwork(), namespace, resolverEndpoint);
    editDialog.close();
    showMessage(`Namespace "${namespace}" updated.`, 'success');
    await loadNamespaces();
  } catch (err) {
    showDialogError('edit-error', describeError(err));
  }
});

// ── Register (POST) ──────────────────────────────────────────────────────────
function openRegisterDialog() {
  $('register-endpoint').value = '';
  hideDialogError('register-error');
  registerDialog.showModal();
}
$('register-btn').addEventListener('click', openRegisterDialog);

$('register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const resolverEndpoint = $('register-endpoint').value.trim();

  const validationError = validateResolverEndpoint(resolverEndpoint);
  if (validationError) {
    showDialogError('register-error', validationError);
    return;
  }

  try {
    const record = await api.registerNamespace(getCurrentNetwork(), resolverEndpoint);
    registerDialog.close();
    openResultDialog(record);
    await loadNamespaces();
  } catch (err) {
    showDialogError('register-error', describeError(err));
  }
});

function openResultDialog(record) {
  $('result-namespace-value').textContent = record?.namespace ?? '-';
  $('result-endpoint').textContent = record?.resolverEndpoint ?? '-';
  $('result-registered-at').textContent = record?.registeredAt ?? '-';
  resultDialog.showModal();
}

$('copy-namespace-btn').addEventListener('click', async () => {
  const value = $('result-namespace-value').textContent;
  try {
    await navigator.clipboard.writeText(value);
    const btn = $('copy-namespace-btn');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch {
    // Clipboard API unavailable (e.g. insecure context) - silently ignore,
    // the value is already visible and selectable in the dialog.
  }
});

// ── History ──────────────────────────────────────────────────────────────────
async function openHistoryDialog(namespace) {
  $('history-namespace').textContent = namespace;
  const content = $('history-content');
  content.replaceChildren(document.createTextNode('Loading history…'));
  historyDialog.showModal();

  try {
    const entries = await api.getHistory(getCurrentNetwork(), namespace);
    renderHistory(content, entries ?? []);
  } catch (err) {
    content.replaceChildren();
    const p = document.createElement('p');
    p.className = 'dialog-error';
    p.textContent = `Failed to load history: ${describeError(err)}`;
    content.appendChild(p);
  }
}

function renderHistory(container, entries) {
  container.replaceChildren();

  if (entries.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No history available.';
    container.appendChild(p);
    return;
  }

  const list = document.createElement('ol');
  list.className = 'history-list';

  for (const entry of entries) {
    const li = document.createElement('li');

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.textContent = `${entry.timestamp ?? '-'} · txId ${entry.txId ?? '-'}${
      entry.isDelete ? ' · DELETED' : ''
    }`;
    li.appendChild(meta);

    if (entry.record) {
      const detail = document.createElement('div');
      detail.className = 'history-detail';
      detail.textContent = `Endpoint: ${entry.record.resolverEndpoint ?? '-'} · registeredBy: ${
        entry.record.registeredBy ?? '-'
      }`;
      li.appendChild(detail);
    }

    list.appendChild(li);
  }
  container.appendChild(list);
}

// ── Error helpers ────────────────────────────────────────────────────────────
// Maps backend errorCode values to specific, actionable messages. Falls back
// to the raw message for anything not explicitly handled.
const ERROR_MESSAGES = {
  PROD_WRITES_DISABLED:
    'Writing to the production network is disabled on this instance.',
  UNAUTHORIZED_REGISTRAR:
    'Not authorized: this namespace was registered by a different organisation.',
  NAMESPACE_ALREADY_EXISTS: 'This namespace already exists.',
  NAMESPACE_NOT_FOUND: 'This namespace was not found on the selected network.',
  INVALID_RESOLVER_ENDPOINT: 'Invalid resolver endpoint.',
  INVALID_NETWORK_PARAMETER: 'Invalid network selection.',
  LEDGER_READ_FAILED: 'The ledger could not be read. Please try again shortly.',
};

function describeError(err) {
  const specific = ERROR_MESSAGES[err.errorCode];
  return specific ? `${specific} (${err.message})` : err.message;
}

// ── Dialog helpers ───────────────────────────────────────────────────────────
document.querySelectorAll('[data-close-dialog]').forEach((btn) => {
  btn.addEventListener('click', () => $(btn.dataset.closeDialog).close());
});

function showDialogError(id, text) {
  const el = $(id);
  el.textContent = text;
  el.classList.remove('hidden');
}
function hideDialogError(id) {
  const el = $(id);
  el.textContent = '';
  el.classList.add('hidden');
}

$('reload-btn').addEventListener('click', loadNamespaces);

// ── Boot ──────────────────────────────────────────────────────────────────────
initConfig();
loadNamespaces();
