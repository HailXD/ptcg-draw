const DB_PATH = "data/cards.sqlite";
const SQLJS_CDN_BASE = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/";
const SLOT_DEFINITION = [
  { slot: 1, rarity_pool: { Common: 100.0 } },
  { slot: 2, rarity_pool: { Common: 100.0 } },
  { slot: 3, rarity_pool: { Common: 100.0 } },
  { slot: 4, rarity_pool: { Common: 100.0 } },
  { slot: 5, rarity_pool: { Uncommon: 100.0 } },
  { slot: 6, rarity_pool: { Uncommon: 100.0 } },
  { slot: 7, rarity_pool: { Uncommon: 100.0 } },
  { slot: 8, rarity_pool: { Common: 60.0, Uncommon: 40.0 } },
  { slot: 9, rarity_pool: { Rare: 80.0, "Rare Holo": 20.0 } },
  {
    slot: 10,
    rarity_pool: {
      Rare: 25.0,
      "Rare Holo": 15.0,
      "Double Rare": 8.0,
      "Rare Holo EX": 5.0,
      "Rare Holo GX": 5.0,
      "Rare Holo V": 5.0,
      "Rare Ultra": 3.0,
      "Ultra Rare": 3.0,
      "Rare Holo VMAX": 3.0,
      "Rare Holo VSTAR": 3.0,
      "Rare BREAK": 2.0,
      "Rare Prime": 2.0,
      "Illustration Rare": 2.0,
      "Rare ACE": 1.5,
      "ACE SPEC Rare": 1.5,
      "Rare Prism Star": 1.5,
      "Radiant Rare": 1.5,
      "Classic Collection": 1.5,
      "Trainer Gallery Rare Holo": 1.5,
      LEGEND: 1.0,
      "Amazing Rare": 1.0,
      "Black White Rare": 1.0,
      "Rare Shining": 1.0,
      "Rare Shiny": 1.0,
      "Shiny Rare": 1.0,
      "Special Illustration Rare": 1.0,
      "Rare Shiny GX": 0.5,
      "Shiny Ultra Rare": 0.5,
      "Rare Holo LV.X": 0.5,
      "Rare Secret": 0.3,
      "Hyper Rare": 0.3,
      "Rare Rainbow": 0.3,
      "Rare Holo Star": 0.2,
      "Mega Hyper Rare": 0.2,
      MEGA_ATTACK_RARE: 0.2
    }
  }
];

const state = {
  db: null,
  packs: [],
  filteredPacks: [],
  quantities: new Map(),
  packCardGroups: new Map()
};

const elements = {
  searchInput: document.getElementById("searchInput"),
  resetBtn: document.getElementById("resetBtn"),
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

function execRows(sql, params = []) {
  const stmt = state.db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function normalizePackRow(row) {
  return {
    packName: row.packName == null ? "" : String(row.packName),
    packSeries: row.packSeries == null ? "" : String(row.packSeries),
    packCode: row.packCode == null ? "" : String(row.packCode),
    releaseDate: row.releaseDate == null ? "" : String(row.releaseDate),
    cardCount: Number(row.cardCount) || 0
  };
}

function loadPacks() {
  const rows = execRows(
    `SELECT packName, packSeries, packCode, releaseDate, COUNT(*) AS cardCount
     FROM cards
     WHERE packName IS NOT NULL
     GROUP BY packName, packSeries, packCode, releaseDate
     ORDER BY releaseDate DESC, packName ASC`
  );
  state.packs = rows.map(normalizePackRow);
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
      selected.push({ pack, quantity });
    }
  }
  return selected;
}

function buildPackGroups(pack) {
  const key = packKey(pack);
  if (state.packCardGroups.has(key)) {
    return state.packCardGroups.get(key);
  }
  const rows = execRows(
    `SELECT id, rarity, number, name, supertype, subtypes, hp, types, evolvesFrom, evolvesTo,
            rules, abilities, attacks, weaknesses, resistances, regulationMark, artist, imageUrl
     FROM cards
     WHERE packName = ?
       AND IFNULL(packSeries, '') = ?
       AND IFNULL(packCode, '') = ?
       AND IFNULL(releaseDate, '') = ?
       AND rarity IS NOT NULL`,
    [pack.packName, pack.packSeries, pack.packCode, pack.releaseDate]
  );
  const groups = new Map();
  for (const row of rows) {
    const rarity = String(row.rarity);
    const card = buildCard(row);
    const list = groups.get(rarity);
    if (list) {
      list.push(card);
    } else {
      groups.set(rarity, [card]);
    }
  }
  state.packCardGroups.set(key, groups);
  return groups;
}

function parseJsonText(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const first = value[0];
  if (first !== "[" && first !== "{") {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

function addIfPresent(obj, key, value) {
  if (value == null) {
    return;
  }
  if (typeof value === "string" && value.trim() === "") {
    return;
  }
  if (Array.isArray(value) && value.length === 0) {
    return;
  }
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
    return;
  }
  obj[key] = value;
}

function simplifyWeaknesses(value) {
  if (Array.isArray(value)) {
    const types = value
      .map((item) => {
        if (item && typeof item === "object" && typeof item.type === "string") {
          return item.type;
        }
        if (typeof item === "string") {
          return item;
        }
        return "";
      })
      .filter((item) => item !== "");
    if (types.length === 0) {
      return undefined;
    }
    if (types.length === 1) {
      return types[0];
    }
    return types;
  }
  if (value && typeof value === "object" && typeof value.type === "string") {
    return value.type;
  }
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  return undefined;
}

function normalizeForLlm(value) {
  if (Array.isArray(value)) {
    const normalizedList = value
      .map((item) => normalizeForLlm(item))
      .filter((item) => item !== undefined);
    if (normalizedList.length === 0) {
      return undefined;
    }
    if (normalizedList.length === 1) {
      return normalizedList[0];
    }
    return normalizedList;
  }
  if (value && typeof value === "object") {
    const normalizedObject = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "convertedEnergyCost") {
        continue;
      }
      const normalizedChild = normalizeForLlm(child);
      if (normalizedChild === undefined) {
        continue;
      }
      normalizedObject[key] = normalizedChild;
    }
    if (Object.keys(normalizedObject).length === 0) {
      return undefined;
    }
    return normalizedObject;
  }
  if (value == null) {
    return undefined;
  }
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }
  return value;
}

function buildCardInfo(row) {
  const info = {};
  addIfPresent(info, "name", row.name == null ? null : String(row.name));
  addIfPresent(info, "supertype", row.supertype == null ? null : String(row.supertype));
  addIfPresent(info, "subtypes", parseJsonText(row.subtypes));
  addIfPresent(info, "hp", row.hp == null ? null : String(row.hp));
  addIfPresent(info, "types", parseJsonText(row.types));
  addIfPresent(info, "evolvesFrom", row.evolvesFrom == null ? null : String(row.evolvesFrom));
  addIfPresent(info, "evolvesTo", parseJsonText(row.evolvesTo));
  addIfPresent(info, "rules", parseJsonText(row.rules));
  addIfPresent(info, "abilities", parseJsonText(row.abilities));
  addIfPresent(info, "attacks", parseJsonText(row.attacks));
  addIfPresent(info, "weaknesses", simplifyWeaknesses(parseJsonText(row.weaknesses)));
  addIfPresent(info, "resistances", parseJsonText(row.resistances));
  return normalizeForLlm(info) || {};
}

function buildCard(row) {
  const info = buildCardInfo(row);
  return {
    id: row.id == null ? "" : String(row.id),
    number: row.number == null ? "" : String(row.number),
    infoJson: JSON.stringify(info)
  };
}

function compileSlotPools(groups) {
  return SLOT_DEFINITION.map((slot) => {
    let totalWeight = 0;
    const bins = [];
    for (const [rarity, weight] of Object.entries(slot.rarity_pool)) {
      const cards = groups.get(rarity);
      if (!cards || cards.length === 0 || weight <= 0) {
        continue;
      }
      totalWeight += weight;
      bins.push({ rarity, ceiling: totalWeight });
    }
    return { bins, totalWeight };
  });
}

function chooseRarity(compiledSlot) {
  if (compiledSlot.totalWeight <= 0) {
    return "";
  }
  const roll = Math.random() * compiledSlot.totalWeight;
  for (const bin of compiledSlot.bins) {
    if (roll < bin.ceiling) {
      return bin.rarity;
    }
  }
  return compiledSlot.bins[compiledSlot.bins.length - 1].rarity;
}

function simulatePackDraw(quantity, groups, slotPools) {
  const counts = new Map();
  const cardById = new Map();
  let totalCards = 0;
  for (let packIndex = 0; packIndex < quantity; packIndex += 1) {
    for (const slot of slotPools) {
      if (slot.totalWeight <= 0) {
        continue;
      }
      const rarity = chooseRarity(slot);
      if (!rarity) {
        continue;
      }
      const cards = groups.get(rarity);
      if (!cards || cards.length === 0) {
        continue;
      }
      const card = cards[Math.floor(Math.random() * cards.length)];
      counts.set(card.id, (counts.get(card.id) || 0) + 1);
      if (!cardById.has(card.id)) {
        cardById.set(card.id, card);
      }
      totalCards += 1;
    }
  }
  return { counts, cardById, totalCards };
}

function compareCardNumber(a, b) {
  const splitParts = (value) => String(value).match(/\d+|\D+/g) || [];
  const left = splitParts(a);
  const right = splitParts(b);
  const size = Math.max(left.length, right.length);
  for (let i = 0; i < size; i += 1) {
    const lp = left[i];
    const rp = right[i];
    if (lp == null) {
      return -1;
    }
    if (rp == null) {
      return 1;
    }
    const ln = Number(lp);
    const rn = Number(rp);
    const lIsNum = Number.isInteger(ln) && lp.trim() !== "";
    const rIsNum = Number.isInteger(rn) && rp.trim() !== "";
    if (lIsNum && rIsNum && ln !== rn) {
      return ln - rn;
    }
    if (lp !== rp) {
      return lp.localeCompare(rp);
    }
  }
  return 0;
}

function buildResultText(resultEntries) {
  const lines = [];
  for (const entry of resultEntries) {
    const { pack, quantity, draw } = entry;
    lines.push(`${pack.packName} | ${pack.packSeries} | ${pack.releaseDate} | opened ${quantity}`);
    const sortedCards = [...draw.counts.entries()].sort((a, b) => {
      const leftCard = draw.cardById.get(a[0]);
      const rightCard = draw.cardById.get(b[0]);
      const leftNumber = leftCard ? leftCard.number : "";
      const rightNumber = rightCard ? rightCard.number : "";
      const numberCmp = compareCardNumber(leftNumber, rightNumber);
      if (numberCmp !== 0) {
        return numberCmp;
      }
      return a[0].localeCompare(b[0]);
    });
    for (const [id, count] of sortedCards) {
      const card = draw.cardById.get(id);
      const parts = [String(count), pack.packCode];
      if (card && card.number) {
        parts.push(card.number);
      }
      const prefix = parts.join(" ");
      const infoJson = card ? card.infoJson : "{}";
      lines.push(`${prefix} # ${infoJson}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

async function openSelectedPacks() {
  const selected = getSelectedPacks();
  if (selected.length === 0) {
    setStatus("Select at least one pack quantity.", true);
    return;
  }

  elements.openBtn.disabled = true;
  setStatus("Opening packs...");

  const results = [];
  for (const entry of selected) {
    const groups = buildPackGroups(entry.pack);
    const slotPools = compileSlotPools(groups);
    const draw = simulatePackDraw(entry.quantity, groups, slotPools);
    results.push({ ...entry, draw });
  }

  elements.resultText.value = buildResultText(results);
  const packCount = selected.reduce((sum, item) => sum + item.quantity, 0);
  const cardCount = results.reduce((sum, item) => sum + item.draw.totalCards, 0);
  setStatus(`Opened ${packCount} packs and drew ${cardCount} cards.`);
  elements.openBtn.disabled = false;
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

async function initDatabase() {
  const initSqlJs = window.initSqlJs;
  if (typeof initSqlJs !== "function") {
    throw new Error("sql.js failed to load");
  }
  const SQL = await initSqlJs({
    locateFile: (file) => `${SQLJS_CDN_BASE}${file}`
  });
  const response = await fetch(DB_PATH);
  if (!response.ok) {
    throw new Error(`Cannot fetch ${DB_PATH}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  state.db = new SQL.Database(bytes);
}

async function init() {
  try {
    await initDatabase();
    loadPacks();
    renderPacks();
    setStatus(`Loaded ${state.packs.length} packs.`);
  } catch (err) {
    setStatus(`Load failed: ${err.message}`, true);
  }
}

elements.searchInput.addEventListener("input", applyFilter);
elements.openBtn.addEventListener("click", openSelectedPacks);
elements.copyBtn.addEventListener("click", copyResultText);
elements.resetBtn.addEventListener("click", resetQuantities);

init();
