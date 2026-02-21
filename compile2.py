import json
import sqlite3
import subprocess
import tempfile
from datetime import date
from pathlib import Path
from typing import Any

CARDS_DIR = Path("cards-database/data")
DB_PATH = Path("data/cards2.sqlite")
TABLE_NAME = "cards"
EXCLUDED_KEYS = {
    "retreatCost",
    "flavorText",
    "legalities",
    "images",
    "nationalPokedexNumbers",
    "set",
}
SQLITE_TYPE_BY_PYTHON_TYPE: dict[type[Any], str] = {
    int: "INTEGER",
    float: "REAL",
    str: "TEXT",
    bool: "INTEGER",
}
NODE_EXTRACT_SCRIPT = """
import fs from 'node:fs';
import path from 'node:path';

const cardsDir = path.resolve(process.argv[2]);
const outputPath = path.resolve(process.argv[3]);
const cache = new Map();

function decodeSpecifier(raw, quote) {
  return Function(`\"use strict\"; return ${quote}${raw}${quote};`)();
}

function resolveImport(fromFile, specifier) {
  if (specifier.includes('/interfaces')) {
    return null;
  }
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [`${base}.ts`, base, path.join(base, 'index.ts')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.resolve(candidate);
    }
  }
  return null;
}

function loadModule(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (cache.has(resolvedPath)) {
    return cache.get(resolvedPath);
  }

  let source = fs.readFileSync(resolvedPath, 'utf8');
  const imports = [];
  const importRegex = /^\\s*import\\s+(.+?)\\s+from\\s+(['\"])((?:\\\\.|(?!\\2).)+)\\2\\s*;?\\s*$/gm;
  let match;
  while ((match = importRegex.exec(source)) !== null) {
    imports.push({
      clause: match[1].trim(),
      specifier: decodeSpecifier(match[3], match[2]),
    });
  }
  source = source.replace(importRegex, '');

  const argNames = [];
  const argValues = [];
  for (const { clause, specifier } of imports) {
    if (clause.startsWith('{')) {
      continue;
    }
    const symbol = clause.split(',')[0].trim();
    if (!/^[A-Za-z_$][\\w$]*$/.test(symbol)) {
      continue;
    }
    const importedPath = resolveImport(resolvedPath, specifier);
    if (!importedPath) {
      continue;
    }
    argNames.push(symbol);
    argValues.push(loadModule(importedPath));
  }

  source = source.replace(/\\b(const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*:\\s*[^=]+=/g, '$1 $2 =');
  if (!/export\\s+default\\s+/.test(source)) {
    throw new Error(`Missing export default in ${resolvedPath}`);
  }
  source = source.replace(/export\\s+default\\s+/, 'return ');

  const fn = new Function(...argNames, `\"use strict\";\\n${source}\\n`);
  const value = fn(...argValues);
  cache.set(resolvedPath, value);
  return value;
}

function collectCardFiles(root) {
  const result = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.ts')) {
        continue;
      }
      const rel = path.relative(root, fullPath).split(path.sep);
      if (rel.length === 3) {
        result.push(fullPath);
      }
    }
  }
  return result.sort();
}

const cards = [];
for (const cardPath of collectCardFiles(cardsDir)) {
  const localId = path.basename(cardPath, '.ts');
  const card = loadModule(cardPath);
  if (!card || typeof card !== 'object') {
    continue;
  }
  if (!card.set || typeof card.set !== 'object' || typeof card.set.id !== 'string') {
    continue;
  }
  cards.push({ ...card, id: `${card.set.id}-${localId}`, number: localId });
}

fs.writeFileSync(outputPath, JSON.stringify(cards), 'utf8');
"""


def collect_cards(cards_dir: Path) -> list[dict[str, Any]]:
    with tempfile.TemporaryDirectory() as temp_dir:
        script_path = Path(temp_dir) / "extract_cards.mjs"
        output_path = Path(temp_dir) / "cards.json"
        script_path.write_text(NODE_EXTRACT_SCRIPT, encoding="utf-8")
        process = subprocess.run(
            ["node", str(script_path), str(cards_dir.resolve()), str(output_path)],
            capture_output=True,
            text=True,
            check=False,
        )
        if process.returncode != 0:
            stderr = process.stderr.strip()
            stdout = process.stdout.strip()
            message = stderr if stderr else stdout
            raise RuntimeError(f"Failed to extract cards from {cards_dir}: {message}")
        with output_path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
    if not isinstance(payload, list):
        raise ValueError("Card extraction output is not a list")
    return [item for item in payload if isinstance(item, dict)]


def infer_columns(cards: list[dict[str, Any]]) -> list[tuple[str, str]]:
    key_types: dict[str, set[type[Any]]] = {}
    for card in cards:
        for key, value in card.items():
            if key in EXCLUDED_KEYS:
                continue
            key_types.setdefault(key, set()).add(type(value))
    if "id" not in key_types:
        raise ValueError("Missing required key: id")
    ordered_keys = ["id"] + sorted(k for k in key_types if k != "id")
    columns: list[tuple[str, str]] = []
    for key in ordered_keys:
        types = key_types[key]
        if len(types) != 1:
            sqlite_type = "TEXT"
        else:
            value_type = next(iter(types))
            if value_type in (list, dict):
                sqlite_type = "TEXT"
            else:
                sqlite_type = SQLITE_TYPE_BY_PYTHON_TYPE.get(value_type, "TEXT")
        columns.append((key, sqlite_type))
    columns.extend(
        [
            ("packName", "TEXT"),
            ("packSeries", "TEXT"),
            ("packCode", "TEXT"),
            ("releaseDate", "DATE"),
            ("imageUrl", "TEXT"),
        ]
    )
    return columns


def encode_value(value: Any) -> Any:
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return value


def create_database(db_path: Path, columns: list[tuple[str, str]]) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode = OFF")
    conn.execute("PRAGMA synchronous = OFF")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA locking_mode = EXCLUSIVE")
    definitions = [f'"{name}" {col_type}' for name, col_type in columns]
    definitions[0] = f"{definitions[0]} PRIMARY KEY"
    conn.execute(f'DROP TABLE IF EXISTS "{TABLE_NAME}"')
    conn.execute(f'CREATE TABLE "{TABLE_NAME}" ({", ".join(definitions)})')
    return conn


def parse_release_date(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value.replace("/", "-"))
    except ValueError:
        return None


def pick_text(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        english = value.get("en")
        if isinstance(english, str):
            return english
        for item in value.values():
            if isinstance(item, str):
                return item
    return None


def pick_pack_metadata(card: dict[str, Any]) -> tuple[str | None, str | None, str | None, date | None]:
    set_info = card.get("set")
    if not isinstance(set_info, dict):
        return (None, None, None, None)
    pack_name = pick_text(set_info.get("name"))
    serie = set_info.get("serie")
    if isinstance(serie, dict):
        pack_series = pick_text(serie.get("name"))
    else:
        pack_series = None
    pack_code = set_info.get("tcgOnline")
    if not isinstance(pack_code, str):
        pack_code = None
    release_value = set_info.get("releaseDate")
    if isinstance(release_value, dict):
        release_value = pick_text(release_value)
    release_date = parse_release_date(release_value)
    return (pack_name, pack_series, pack_code, release_date)


def insert_cards(
    conn: sqlite3.Connection,
    cards: list[dict[str, Any]],
    columns: list[tuple[str, str]],
) -> int:
    column_names = [name for name, _ in columns]
    placeholders = ", ".join("?" for _ in column_names)
    quoted_columns = ", ".join(f'"{name}"' for name in column_names)
    sql = f'INSERT INTO "{TABLE_NAME}" ({quoted_columns}) VALUES ({placeholders})'
    total = 0
    with conn:
        rows = []
        for card in cards:
            pack_name, pack_series, pack_code, release_date = pick_pack_metadata(card)
            image_url = None
            images = card.get("images")
            if isinstance(images, dict):
                image_value = images.get("small")
                if isinstance(image_value, str):
                    image_url = image_value
            if image_url is None:
                image = card.get("image")
                if isinstance(image, str):
                    image_url = image
            values: list[Any] = []
            for name in column_names:
                if name == "packName":
                    values.append(pack_name)
                elif name == "packSeries":
                    values.append(pack_series)
                elif name == "packCode":
                    values.append(pack_code)
                elif name == "releaseDate":
                    values.append(release_date.isoformat() if release_date is not None else None)
                elif name == "imageUrl":
                    values.append(image_url)
                else:
                    values.append(encode_value(card.get(name)))
            rows.append(tuple(values))
        conn.executemany(sql, rows)
        total += len(rows)
    return total


def main() -> None:
    cards = collect_cards(CARDS_DIR)
    if not cards:
        raise FileNotFoundError(f"No cards found in {CARDS_DIR}")
    columns = infer_columns(cards)
    conn = create_database(DB_PATH, columns)
    total = insert_cards(conn, cards, columns)
    conn.execute("VACUUM")
    conn.close()
    print(f"Compiled {total} cards into {DB_PATH}")


if __name__ == "__main__":
    main()
