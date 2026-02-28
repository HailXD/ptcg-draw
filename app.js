const API_BASE = "https://api-pearl-two-79.vercel.app";
const PACKS_ENDPOINT = `${API_BASE}/api/packs`;
const DRAW_ENDPOINT = `${API_BASE}/api/draw`;
const RESULT_END_MARKER = "\n\n===\n";
const DEFAULT_PACKS_LIMIT = 5;
const PAGING_ENABLED_BY_DEFAULT = true;

const state = {
  seed: "",
  packs: [],
  filteredPacks: [],
  quantities: new Map(),
  packByKey: new Map(),
  packsPageCache: new Map(),
  packLookupLoaded: false,
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
  seedInput: document.getElementById("seedInput"),
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
  return pack.packName;
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

function cachePackLookup(rows) {
  for (const row of rows) {
    const pack = normalizePack(row);
    state.packByKey.set(packKey(pack), pack);
  }
}

function generateSeed() {
  let x = "";
  let n = Math.floor(Date.now() / 10);
  while (n > 0) {
    x = String.fromCharCode(97 + (n % 26)) + x;
    n = Math.floor(n / 26);
  }
  return x || "a";
}

function setSeed(value) {
  state.seed = String(value ?? "").trim();
  if (elements.seedInput && elements.seedInput.value !== state.seed) {
    elements.seedInput.value = state.seed;
  }
}

function ensureSeed() {
  const current = elements.seedInput ? elements.seedInput.value.trim() : state.seed;
  if (current) {
    setSeed(current);
    return current;
  }
  const seed = generateSeed();
  setSeed(seed);
  return seed;
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

function packsCacheKey() {
  if (!state.pagination.enabled) {
    return "all";
  }
  return `paged:${state.pagination.limit}:${state.pagination.page}`;
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

function applyPacksPayload(payload) {
  const rows = Array.isArray(payload?.packs) ? payload.packs : [];
  state.packs = rows.map(normalizePack);
  cachePackLookup(rows);
  state.filteredPacks = state.packs.slice();

  if (!state.pagination.enabled) {
    state.packLookupLoaded = true;
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

async function loadPacks() {
  const cacheKey = packsCacheKey();
  let payload = state.packsPageCache.get(cacheKey);
  if (!payload) {
    payload = await fetchJson(packsUrl());
    state.packsPageCache.set(cacheKey, payload);
  }
  applyPacksPayload(payload);
}

async function ensurePackLookup() {
  if (state.packLookupLoaded) {
    return;
  }
  let payload = state.packsPageCache.get("all");
  if (!payload) {
    payload = await fetchJson(PACKS_ENDPOINT);
    state.packsPageCache.set("all", payload);
  }
  const rows = Array.isArray(payload?.packs) ? payload.packs : [];
  cachePackLookup(rows);
  state.packLookupLoaded = true;
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

    const controls = document.createElement("div");
    controls.className = "pack-quantity-controls";

    const add10Btn = document.createElement("button");
    add10Btn.type = "button";
    add10Btn.className = "pack-add-btn";
    add10Btn.textContent = "+10";
    add10Btn.addEventListener("click", () => {
      const parsed = Number.parseInt(quantityInput.value, 10);
      const current = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      const next = current + 10;
      state.quantities.set(key, next);
      quantityInput.value = String(next);
    });

    const add30Btn = document.createElement("button");
    add30Btn.type = "button";
    add30Btn.className = "pack-add-btn";
    add30Btn.textContent = "+30";
    add30Btn.addEventListener("click", () => {
      const parsed = Number.parseInt(quantityInput.value, 10);
      const current = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      const next = current + 30;
      state.quantities.set(key, next);
      quantityInput.value = String(next);
    });

    const add50Btn = document.createElement("button");
    add50Btn.type = "button";
    add50Btn.className = "pack-add-btn";
    add50Btn.textContent = "+50";
    add50Btn.addEventListener("click", () => {
      const parsed = Number.parseInt(quantityInput.value, 10);
      const current = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      const next = current + 50;
      state.quantities.set(key, next);
      quantityInput.value = String(next);
    });

    controls.append(quantityInput, add10Btn, add30Btn, add50Btn);
    row.append(info, controls);
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
  const selected = {};
  for (const [key, quantity] of state.quantities) {
    if (quantity > 0) {
      selected[key] = quantity;
    }
  }
  return selected;
}

function getExportPayload() {
  return {
    seed: ensureSeed(),
    packs: getSelectedPacks()
  };
}

function withResultEndMarker(value) {
  const text = String(value ?? "");
  if (text.endsWith(RESULT_END_MARKER)) {
    return text;
  }
  return `${text}${RESULT_END_MARKER}`;
}

async function openSelectedPacks() {
  const exportInfo = getExportPayload();
  if (Object.keys(exportInfo.packs).length === 0) {
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
        packs: exportInfo.packs,
        seed: exportInfo.seed,
        exportInfo,
        drawHighestRaritySameCard: Boolean(elements.drawHighestRaritySameCard?.checked)
      })
    });
    const resultText = payload && typeof payload.text === "string" ? payload.text : "";
    elements.resultText.value = withResultEndMarker(resultText);
    const packCount = Number(payload?.packCount) || 0;
    const cardCount = Number(payload?.cardCount) || 0;
    const seed = typeof payload?.seed === "string" && payload.seed ? payload.seed : exportInfo.seed;
    setStatus(`Opened ${packCount} packs and drew ${cardCount} cards. Seed: ${seed}`);
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
  const payload = getExportPayload();
  elements.selectionText.value = JSON.stringify(payload);
  setStatus(`Exported ${Object.keys(payload.packs).length} pack selections.`);
}

function getImportedEntries(parsed) {
  const source = Array.isArray(parsed) ? parsed : parsed?.packs;
  if (Array.isArray(source)) {
    return source.map((item) => [item?.packName, item?.quantity]);
  }
  if (source && typeof source === "object") {
    return Object.entries(source);
  }
  return [];
}

async function importSelection() {
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
  const seed = typeof parsed?.seed === "string" ? parsed.seed.trim() : "";
  if (seed) {
    setSeed(seed);
  }
  const entries = getImportedEntries(parsed);
  if (entries.length === 0) {
    state.quantities.clear();
    renderPacks();
    setStatus("Imported 0 selections.");
    return;
  }

  try {
    await ensurePackLookup();
  } catch (err) {
    setStatus(`Import lookup failed: ${String(err.message || err)}`, true);
    return;
  }

  state.quantities.clear();
  let imported = 0;
  for (const [packNameValue, quantityValue] of entries) {
    const packName = String(packNameValue ?? "").trim();
    if (!packName || !state.packByKey.has(packName)) {
      continue;
    }
    const parsedQuantity = Number.parseInt(String(quantityValue ?? 0), 10);
    const quantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 0;
    if (quantity <= 0) {
      continue;
    }
    state.quantities.set(packName, quantity);
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
  ensureSeed();
  await reloadPacks("Loaded");
}

elements.searchInput.addEventListener("input", applyFilter);
elements.openBtn.addEventListener("click", openSelectedPacks);
elements.copyBtn.addEventListener("click", copyResultText);
elements.resetBtn.addEventListener("click", resetQuantities);
elements.exportBtn.addEventListener("click", exportSelection);
elements.importBtn.addEventListener("click", () => void importSelection());
elements.seedInput?.addEventListener("input", () => {
  state.seed = elements.seedInput.value.trim();
});
elements.prevPageBtn?.addEventListener("click", () => void goToPage(-1));
elements.nextPageBtn?.addEventListener("click", () => void goToPage(1));
elements.togglePagingBtn?.addEventListener("click", () => void togglePagination());

init();
