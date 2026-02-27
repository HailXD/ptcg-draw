import json
from pathlib import Path
from typing import Any

INPUT_PATH = Path("pokemon-tcg-data/sets/en2.json")
OUTPUT_PATH = Path("pokemon-tcg-data/sets/en2.json")
KEY_ORDER = [
    "id",
    "name",
    "series",
    "printedTotal",
    "total",
    "legalities",
    "ptcgoCode",
    "releaseDate",
    "updatedAt",
    "images",
]


def flatten_sets(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        return [value]
    if not isinstance(value, list):
        return []
    result: list[dict[str, Any]] = []
    for item in value:
        result.extend(flatten_sets(item))
    return result


def reorder_keys(item: dict[str, Any]) -> dict[str, Any]:
    ordered: dict[str, Any] = {}
    for key in KEY_ORDER:
        if key in item:
            ordered[key] = item[key]
    for key, value in item.items():
        if key not in ordered:
            ordered[key] = value
    return ordered


def convert_sets(data: Any) -> list[dict[str, Any]]:
    flat = flatten_sets(data)
    return [reorder_keys(item) for item in flat]


def main() -> None:
    with INPUT_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    converted = convert_sets(data)
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(converted, f, ensure_ascii=False, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
