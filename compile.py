import json
import sqlite3
from datetime import date
from pathlib import Path
from typing import Any

CARDS_DIR = Path("pokemon-tcg-data/cards/en")
SETS_PATH = Path("pokemon-tcg-data/sets/en.json")
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
    columns.extend(
        [
            ("packName", "TEXT"),
            ("packSeries", "TEXT"),
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
    definitions[0] = f'{definitions[0]} PRIMARY KEY'
    conn.execute(f'DROP TABLE IF EXISTS "{TABLE_NAME}"')
    conn.execute(f'CREATE TABLE "{TABLE_NAME}" ({", ".join(definitions)})')
    return conn


def insert_cards(
    conn: sqlite3.Connection,
    card_files: list[Path],
    columns: list[tuple[str, str]],
    set_metadata: dict[str, tuple[str | None, str | None, date | None]],
) -> int:
    column_names = [name for name, _ in columns]
    placeholders = ", ".join("?" for _ in column_names)
    quoted_columns = ", ".join(f'"{name}"' for name in column_names)
    sql = f'INSERT INTO "{TABLE_NAME}" ({quoted_columns}) VALUES ({placeholders})'
    total = 0
    with conn:
        for path in card_files:
            pack_name, pack_series, release_date = set_metadata.get(path.stem, (None, None, None))
            with path.open("r", encoding="utf-8") as f:
                cards = json.load(f)
            rows = []
            for card in cards:
                image_url = None
                images = card.get("images")
                if isinstance(images, dict):
                    image_url = images.get("small")
                values: list[Any] = []
                for name in column_names:
                    if name == "packName":
                        values.append(pack_name)
                    elif name == "packSeries":
                        values.append(pack_series)
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


def parse_release_date(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value.replace("/", "-"))
    except ValueError:
        return None


def load_set_metadata(sets_path: Path) -> dict[str, tuple[str | None, str | None, date | None]]:
    with sets_path.open("r", encoding="utf-8") as f:
        sets = json.load(f)
    metadata: dict[str, tuple[str | None, str | None, date | None]] = {}
    for item in sets:
        metadata[item["id"]] = (
            item.get("name"),
            item.get("series"),
            parse_release_date(item.get("releaseDate")),
        )
    return metadata


def main() -> None:
    card_files = iter_card_files(CARDS_DIR)
    if not card_files:
        raise FileNotFoundError(f"No JSON files found in {CARDS_DIR}")
    set_metadata = load_set_metadata(SETS_PATH)
    columns = infer_columns(card_files)
    conn = create_database(DB_PATH, columns)
    total = insert_cards(conn, card_files, columns, set_metadata)
    conn.execute("VACUUM")
    conn.close()
    print(f"Compiled {total} cards into {DB_PATH}")


if __name__ == "__main__":
    main()
