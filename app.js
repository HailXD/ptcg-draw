const API_BASE = "https://api-pearl-two-79.vercel.app";
const PACKS_ENDPOINT = `${API_BASE}/api/packs`;
const DRAW_ENDPOINT = `${API_BASE}/api/draw`;
const RESULT_END_MARKER = "\n\n===\n";

const state = {
  packs: [],
  filteredPacks: [],
  quantities: new Map()
};

const elements = {
  searchInput: document.getElementById("searchInput"),
  resetBtn: document.getElementById("resetBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  openBtn: document.getElementById("openBtn"),
  copyBtn: document.getElementById("copyBtn"),
  statusText: document.getElementById("statusText"),
  packList: document.getElementById("packList"),
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
  const payload = await fetchJson(PACKS_ENDPOINT);
  const rows = Array.isArray(payload?.packs) ? payload.packs : [];
  state.packs = rows.map(normalizePack);
  state.filteredPacks = state.packs.slice();
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
  for (const pack of state.packs) {
    const quantity = state.quantities.get(packKey(pack)) || 0;
    if (quantity > 0) {
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
      body: JSON.stringify({ packs: selected })
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
    quantity: entry.quantity
  }));
  const payload = { version: 1, packs: selected };
  elements.resultText.value = JSON.stringify(payload);
  setStatus(`Exported ${selected.length} pack selections.`);
}

function importSelection() {
  const raw = elements.resultText.value.trim();
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

  const validKeys = new Set(state.packs.map((pack) => packKey(pack)));
  state.quantities.clear();
  let imported = 0;
  for (const item of packs) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const pack = {
      packName: item.packName == null ? "" : String(item.packName),
      packSeries: item.packSeries == null ? "" : String(item.packSeries),
      packCode: item.packCode == null ? "" : String(item.packCode),
      releaseDate: item.releaseDate == null ? "" : String(item.releaseDate)
    };
    const parsedQuantity = Number.parseInt(String(item.quantity ?? 0), 10);
    const quantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 0;
    if (quantity <= 0) {
      continue;
    }
    const key = packKey(pack);
    if (!validKeys.has(key)) {
      continue;
    }
    state.quantities.set(key, quantity);
    imported += 1;
  }
  renderPacks();
  setStatus(`Imported ${imported} pack selections.`);
}

async function init() {
  try {
    await loadPacks();
    renderPacks();
    setStatus(`Loaded ${state.packs.length} packs from API.`);
  } catch (err) {
    setStatus(`Load failed: ${String(err.message || err)}`, true);
  }
}

elements.searchInput.addEventListener("input", applyFilter);
elements.openBtn.addEventListener("click", openSelectedPacks);
elements.copyBtn.addEventListener("click", copyResultText);
elements.resetBtn.addEventListener("click", resetQuantities);
elements.exportBtn.addEventListener("click", exportSelection);
elements.importBtn.addEventListener("click", importSelection);

init();
