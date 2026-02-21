import json
import sqlite3
from pathlib import Path
from typing import Any

CARDS_DIR = Path("pokemon-tcg-data/cards/en")
DB_PATH = Path("data/cards.sqlite")
TABLE_NAME = "cards"
EXCLUDED_KEYS = {
    "retreatCost",
    "flavorText",
    "legalities",
    "images",
    "nationalPokedexNumbers",
}
SQLITE_TYPE_BY_PYTHON_TYPE: dict[type[Any], str] = {
    int: "INTEGER",
    float: "REAL",
    str: "TEXT",
    bool: "INTEGER",
}


def iter_card_files(cards_dir: Path) -> list[Path]:
    return sorted(cards_dir.glob("*.json"))


def infer_columns(card_files: list[Path]) -> list[tuple[str, str]]:
    key_types: dict[str, set[type[Any]]] = {}
    for path in card_files:
        with path.open("r", encoding="utf-8") as f:
            cards = json.load(f)
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
    definitions[0] = f'{definitions[0]} PRIMARY KEY'
    conn.execute(f'DROP TABLE IF EXISTS "{TABLE_NAME}"')
    conn.execute(f'CREATE TABLE "{TABLE_NAME}" ({", ".join(definitions)})')
    return conn


def insert_cards(
    conn: sqlite3.Connection,
    card_files: list[Path],
    columns: list[tuple[str, str]],
) -> int:
    column_names = [name for name, _ in columns]
    placeholders = ", ".join("?" for _ in column_names)
    quoted_columns = ", ".join(f'"{name}"' for name in column_names)
    sql = f'INSERT INTO "{TABLE_NAME}" ({quoted_columns}) VALUES ({placeholders})'
    total = 0
    with conn:
        for path in card_files:
            with path.open("r", encoding="utf-8") as f:
                cards = json.load(f)
            rows = [
                tuple(encode_value(card.get(name)) for name in column_names) for card in cards
            ]
            conn.executemany(sql, rows)
            total += len(rows)
    return total


def main() -> None:
    card_files = iter_card_files(CARDS_DIR)
    if not card_files:
        raise FileNotFoundError(f"No JSON files found in {CARDS_DIR}")
    columns = infer_columns(card_files)
    conn = create_database(DB_PATH, columns)
    total = insert_cards(conn, card_files, columns)
    conn.execute("VACUUM")
    conn.close()
    print(f"Compiled {total} cards into {DB_PATH}")


if __name__ == "__main__":
    main()
