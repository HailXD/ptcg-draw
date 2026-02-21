const API_BASE = "https://api-pearl-two-79.vercel.app";
const PACKS_ENDPOINT = `${API_BASE}/api/packs`;
const DRAW_ENDPOINT = `${API_BASE}/api/draw`;
const RESULT_END_MARKER = "\n\n===\n";
const DEFAULT_PACKS_LIMIT = 5;
const PAGING_ENABLED_BY_DEFAULT = true;

const state = {
  packs: [],
  filteredPacks: [],
  quantities: new Map(),
  packByKey: new Map(),
  pagination: {
    enabled: PAGING_ENABLED_BY_DEFAULT,
    limit: DEFAULT_PACKS_LIMIT,
    page: 1,
    count: 0,
    total: 0,
    totalPages: 1
  }
};

const elements = {
  searchInput: document.getElementById("searchInput"),
  resetBtn: document.getElementById("resetBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  openBtn: document.getElementById("openBtn"),
  drawHighestRaritySameCard: document.getElementById("drawHighestRaritySameCard"),
  copyBtn: document.getElementById("copyBtn"),
  statusText: document.getElementById("statusText"),
  packList: document.getElementById("packList"),
  pageInfo: document.getElementById("pageInfo"),
  prevPageBtn: document.getElementById("prevPageBtn"),
  nextPageBtn: document.getElementById("nextPageBtn"),
  togglePagingBtn: document.getElementById("togglePagingBtn"),
  selectionText: document.getElementById("selectionText"),
  resultText: document.getElementById("resultText")
};

function packKey(pack) {
  return `${pack.packName}\u0000${pack.packSeries}\u0000${pack.releaseDate}\u0000${pack.packCode}`;
}

function setStatus(text, isError = false) {
  elements.statusText.textContent = text;
  elements.statusText.classList.toggle("error", isError);
}

function normalizePack(row) {
  return {
    packName: row.packName == null ? "" : String(row.packName),
    packSeries: row.packSeries == null ? "" : String(row.packSeries),
    packCode: row.packCode == null ? "" : String(row.packCode),
    releaseDate: row.releaseDate == null ? "" : String(row.releaseDate),
    cardCount: Number(row.cardCount) || 0
  };
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function packsUrl() {
  const url = new URL(PACKS_ENDPOINT);
  if (state.pagination.enabled) {
    url.searchParams.set("limit", String(state.pagination.limit));
    url.searchParams.set("page", String(state.pagination.page));
  }
  return url.toString();
}

async function fetchJson(url, options = undefined) {
  const response = await fetch(url, options);
  let body = null;
  try {
    body = await response.json();
  } catch (err) {
    body = null;
  }
  if (!response.ok) {
    const message = body && typeof body.error === "string" ? body.error : `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return body;
}

async function loadPacks() {
  const payload = await fetchJson(packsUrl());
  const rows = Array.isArray(payload?.packs) ? payload.packs : [];
  state.packs = rows.map(normalizePack);
  for (const pack of state.packs) {
    state.packByKey.set(packKey(pack), pack);
  }
  state.filteredPacks = state.packs.slice();

  if (!state.pagination.enabled) {
    state.pagination.page = 1;
    state.pagination.count = state.packs.length;
    state.pagination.total = state.packs.length;
    state.pagination.totalPages = 1;
    return;
  }

  state.pagination.limit = parsePositiveInt(payload?.limit, state.pagination.limit);
  state.pagination.page = parsePositiveInt(payload?.page, state.pagination.page);
  state.pagination.count = parseNonNegativeInt(payload?.count, state.packs.length);
  state.pagination.total = parseNonNegativeInt(payload?.total, state.packs.length);
  state.pagination.totalPages = parsePositiveInt(
    payload?.totalPages,
    Math.max(1, Math.ceil(state.pagination.total / state.pagination.limit))
  );
}

function updatePaginationUi() {
  if (!elements.pageInfo || !elements.prevPageBtn || !elements.nextPageBtn || !elements.togglePagingBtn) {
    return;
  }

  const visible = state.filteredPacks.length;
  if (state.pagination.enabled) {
    elements.pageInfo.textContent =
      `Showing ${visible} of ${state.pagination.count} on page ${state.pagination.page}/${state.pagination.totalPages} (${state.pagination.total} total)`;
  } else {
    elements.pageInfo.textContent = `Showing ${visible} of ${state.packs.length} packs`;
  }

  elements.togglePagingBtn.textContent = state.pagination.enabled
    ? "Show All"
    : `Show ${state.pagination.limit}/Page`;

  elements.prevPageBtn.disabled = !state.pagination.enabled || state.pagination.page <= 1;
  elements.nextPageBtn.disabled =
    !state.pagination.enabled || state.pagination.page >= state.pagination.totalPages;
}

function withPacksControlsDisabled(disabled) {
  if (elements.togglePagingBtn) {
    elements.togglePagingBtn.disabled = disabled;
  }
  if (elements.prevPageBtn) {
    elements.prevPageBtn.disabled = disabled;
  }
  if (elements.nextPageBtn) {
    elements.nextPageBtn.disabled = disabled;
  }
}

async function reloadPacks(statusPrefix = "Loaded") {
  withPacksControlsDisabled(true);
  setStatus("Loading packs...");
  try {
    await loadPacks();
    applyFilter();
    if (state.pagination.enabled) {
      setStatus(
        `${statusPrefix} page ${state.pagination.page}/${state.pagination.totalPages} (${state.pagination.count}/${state.pagination.total} packs).`
      );
    } else {
      setStatus(`${statusPrefix} ${state.packs.length} packs.`);
    }
  } catch (err) {
    setStatus(`Load failed: ${String(err.message || err)}`, true);
  } finally {
    withPacksControlsDisabled(false);
    updatePaginationUi();
  }
}

function renderPacks() {
  const fragment = document.createDocumentFragment();
  for (const pack of state.filteredPacks) {
    const key = packKey(pack);
    const row = document.createElement("div");
    row.className = "pack-row";

    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "pack-name";
    name.textContent = pack.packName;

    const meta = document.createElement("div");
    meta.className = "pack-meta";
    meta.textContent = `${pack.packSeries} | ${pack.packCode} | ${pack.releaseDate} | ${pack.cardCount} cards`;

    info.append(name, meta);

    const quantityInput = document.createElement("input");
    quantityInput.type = "number";
    quantityInput.min = "0";
    quantityInput.step = "1";
    quantityInput.value = String(state.quantities.get(key) || 0);
    quantityInput.addEventListener("input", () => {
      const parsed = Number.parseInt(quantityInput.value, 10);
      const quantity = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      state.quantities.set(key, quantity);
      if (quantity === 0 && quantityInput.value !== "0" && quantityInput.value !== "") {
        quantityInput.value = "0";
      }
    });

    row.append(info, quantityInput);
    fragment.append(row);
  }

  elements.packList.innerHTML = "";
  elements.packList.append(fragment);
  updatePaginationUi();
}

function applyFilter() {
  const q = elements.searchInput.value.trim().toLowerCase();
  if (!q) {
    state.filteredPacks = state.packs.slice();
  } else {
    state.filteredPacks = state.packs.filter((pack) => {
      return (
        pack.packName.toLowerCase().includes(q) ||
        pack.packSeries.toLowerCase().includes(q) ||
        pack.packCode.toLowerCase().includes(q) ||
        pack.releaseDate.toLowerCase().includes(q)
      );
    });
  }
  renderPacks();
}

function getSelectedPacks() {
  const selected = [];
  for (const [key, quantity] of state.quantities) {
    if (quantity > 0) {
      const pack = state.packByKey.get(key);
      if (!pack) {
        continue;
      }
      selected.push({ ...pack, quantity });
    }
  }
  return selected;
}

function withResultEndMarker(value) {
  const text = String(value ?? "");
  if (text.endsWith(RESULT_END_MARKER)) {
    return text;
  }
  return `${text}${RESULT_END_MARKER}`;
}

async function openSelectedPacks() {
  const selected = getSelectedPacks();
  if (selected.length === 0) {
    setStatus("Select at least one pack quantity.", true);
    return;
  }

  elements.openBtn.disabled = true;
  setStatus("Requesting draw...");
  try {
    const payload = await fetchJson(DRAW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        packs: selected,
        drawHighestRaritySameCard: Boolean(elements.drawHighestRaritySameCard?.checked)
      })
    });
    const resultText = payload && typeof payload.text === "string" ? payload.text : "";
    elements.resultText.value = withResultEndMarker(resultText);
    const packCount = Number(payload?.packCount) || 0;
    const cardCount = Number(payload?.cardCount) || 0;
    setStatus(`Opened ${packCount} packs and drew ${cardCount} cards.`);
  } catch (err) {
    setStatus(String(err.message || err), true);
  } finally {
    elements.openBtn.disabled = false;
  }
}

async function copyResultText() {
  const value = elements.resultText.value;
  if (!value) {
    setStatus("No result text to copy.", true);
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    setStatus("Results copied.");
  } catch (err) {
    setStatus("Clipboard copy failed.", true);
  }
}

function resetQuantities() {
  state.quantities.clear();
  renderPacks();
  setStatus("Quantities reset.");
}

function exportSelection() {
  const selected = getSelectedPacks().map((entry) => ({
    packName: entry.packName,
    packSeries: entry.packSeries,
    packCode: entry.packCode,
    releaseDate: entry.releaseDate,
    cardCount: entry.cardCount,
    quantity: entry.quantity
  }));
  const payload = { version: 1, packs: selected };
  elements.selectionText.value = JSON.stringify(payload);
  setStatus(`Exported ${selected.length} pack selections.`);
}

function importSelection() {
  const raw = elements.selectionText.value.trim();
  if (!raw) {
    setStatus("Textarea is empty. Paste exported selection JSON first.", true);
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    setStatus("Invalid JSON in textarea.", true);
    return;
  }
  const packs = Array.isArray(parsed?.packs) ? parsed.packs : [];
  if (packs.length === 0) {
    state.quantities.clear();
    renderPacks();
    setStatus("Imported 0 selections.");
    return;
  }

  state.quantities.clear();
  let imported = 0;
  for (const item of packs) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const parsedQuantity = Number.parseInt(String(item.quantity ?? 0), 10);
    const quantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 0;
    if (quantity <= 0) {
      continue;
    }
    const normalized = normalizePack({ ...item, cardCount: item.cardCount });
    const key = packKey(normalized);
    const existing = state.packByKey.get(key);
    state.packByKey.set(
      key,
      existing
        ? { ...existing, ...normalized, cardCount: existing.cardCount || normalized.cardCount }
        : normalized
    );
    state.quantities.set(key, quantity);
    imported += 1;
  }
  renderPacks();
  setStatus(`Imported ${imported} pack selections.`);
}

async function goToPage(delta) {
  if (!state.pagination.enabled) {
    return;
  }
  const nextPage = Math.min(
    state.pagination.totalPages,
    Math.max(1, state.pagination.page + delta)
  );
  if (nextPage === state.pagination.page) {
    return;
  }
  state.pagination.page = nextPage;
  await reloadPacks("Loaded");
}

async function togglePagination() {
  state.pagination.enabled = !state.pagination.enabled;
  state.pagination.page = 1;
  await reloadPacks("Loaded");
}

async function init() {
  await reloadPacks("Loaded");
}

elements.searchInput.addEventListener("input", applyFilter);
elements.openBtn.addEventListener("click", openSelectedPacks);
elements.copyBtn.addEventListener("click", copyResultText);
elements.resetBtn.addEventListener("click", resetQuantities);
elements.exportBtn.addEventListener("click", exportSelection);
elements.importBtn.addEventListener("click", importSelection);
elements.prevPageBtn?.addEventListener("click", () => void goToPage(-1));
elements.nextPageBtn?.addEventListener("click", () => void goToPage(1));
elements.togglePagingBtn?.addEventListener("click", () => void togglePagination());

init();
