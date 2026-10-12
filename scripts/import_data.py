"""Build a self-contained, read-only SQLite Pokédex from a local PokéAPI checkout."""
from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TABLES = [
    'pokemon', 'pokemon_species', 'pokemon_species_names', 'pokemon_species_flavor_text',
    'pokemon_forms', 'pokemon_form_names', 'pokemon_types', 'pokemon_types_past',
    'pokemon_stats', 'pokemon_stats_past', 'pokemon_abilities', 'pokemon_abilities_past',
    'pokemon_egg_groups', 'pokemon_evolution', 'pokemon_moves', 'pokemon_move_methods',
    'pokemon_move_method_prose', 'moves', 'move_names', 'move_flavor_text',
    'move_changelog', 'move_meta', 'move_effect_prose', 'machines',
    'abilities', 'ability_names', 'ability_flavor_text', 'ability_prose',
    'items', 'item_names', 'item_flavor_text', 'item_prose', 'item_category_prose',
    'types', 'type_names', 'type_efficacy', 'type_efficacy_past',
    'versions', 'version_groups', 'version_names', 'generation_names',
    'egg_group_prose', 'growth_rate_prose', 'location_names',
    'evolution_triggers', 'evolution_trigger_prose', 'regions', 'region_names',
]
TEXT_FIELDS = {
    'identifier', 'name', 'genus', 'flavor_text', 'form_identifier', 'form_name',
    'pokemon_name', 'time_of_day', 'condition_expression', 'short_effect', 'effect',
    'description', 'formula', 'relative_physical_stats',
}
LANGUAGES = {4, 9, 12}


def read_csv(csv_root: Path, name: str):
    with (csv_root / f'{name}.csv').open(encoding='utf-8-sig', newline='') as stream:
        yield from csv.DictReader(stream)


def number(value):
    if value in (None, ''):
        return None
    try:
        return int(value)
    except ValueError:
        return value


def import_table(db, csv_root, name):
    with (csv_root / f'{name}.csv').open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        fields = reader.fieldnames
        if not fields or any(not re.fullmatch(r'[a-z_]+', field) for field in fields):
            raise ValueError(f'Invalid CSV schema: {name}')
        definitions = ','.join(f'"{field}" {"TEXT" if field in TEXT_FIELDS else "INTEGER"}' for field in fields)
        db.execute(f'CREATE TABLE "{name}" ({definitions})')
        columns = ','.join(f'"{field}"' for field in fields)
        statement = f'INSERT INTO "{name}" ({columns}) VALUES ({",".join("?" for _ in fields)})'
        language_field = next((field for field in ('local_language_id', 'language_id') if field in fields), None)
        batch = []
        count = 0
        for row in reader:
            if language_field and number(row[language_field]) not in LANGUAGES:
                continue
            batch.append(tuple((row[field] or None) if field in TEXT_FIELDS else number(row[field]) for field in fields))
            count += 1
            if len(batch) == 5000:
                db.executemany(statement, batch)
                batch.clear()
        if batch:
            db.executemany(statement, batch)
        if 'id' in fields:
            db.execute(f'CREATE INDEX "idx_{name}__id" ON "{name}" (id)')
        for field in ('pokemon_id', 'pokemon_species_id', 'species_id', 'move_id', 'ability_id',
                      'item_id', 'evolved_species_id', 'pokemon_form_id', 'type_id', 'generation_id'):
            if field in fields:
                db.execute(f'CREATE INDEX "idx_{name}__{field}" ON "{name}" ("{field}")')
        print(f'{name}: {count:,}', flush=True)
        return count


def localized(db, table, id_field, value_field='name'):
    rows = db.execute(f'SELECT {id_field}, local_language_id, {value_field} FROM {table}').fetchall()
    result = {}
    for language in (9, 4, 12):
        for entity_id, row_language, value in rows:
            if row_language == language and value:
                result[entity_id] = value
    return result


def copy_assets(db, source, output):
    output.mkdir(parents=True, exist_ok=True)
    sprites = source / 'data/v2/sprites/sprites'
    image_map = {}
    copied = Counter()
    for row in db.execute('SELECT id FROM pokemon'):
        pokemon_id = row[0]
        paths = {}
        for category, source_folder in (
            ('artwork', 'pokemon/other/official-artwork'),
            ('sprite', 'pokemon'),
            ('emerald', 'pokemon/versions/generation-iii/emerald'),
            ('firered', 'pokemon/versions/generation-iii/firered-leafgreen'),
            ('ruby', 'pokemon/versions/generation-iii/ruby-sapphire'),
        ):
            asset = sprites / source_folder / f'{pokemon_id}.png'
            if asset.is_file():
                target = output / category / asset.name
                target.parent.mkdir(exist_ok=True)
                if not target.exists() or target.stat().st_size != asset.stat().st_size:
                    shutil.copyfile(asset, target)
                paths[category] = f'assets/{category}/{asset.name}'
                copied[category] += 1
        image_map[pokemon_id] = paths
    for item_id, identifier in db.execute('SELECT id, identifier FROM items'):
        asset = sprites / 'items' / f'{identifier}.png'
        if asset.is_file():
            target = output / 'items' / f'{item_id}.png'
            target.parent.mkdir(exist_ok=True)
            shutil.copyfile(asset, target)
            copied['items'] += 1
    print(f'Images: {dict(copied)}', flush=True)
    return image_map, dict(copied)


def build_catalog(db, images):
    db.row_factory = sqlite3.Row
    species = {row['id']: dict(row) for row in db.execute('SELECT * FROM pokemon_species')}
    names = localized(db, 'pokemon_species_names', 'pokemon_species_id')
    english = {row['pokemon_species_id']: row['name'] for row in db.execute(
        'SELECT pokemon_species_id, name FROM pokemon_species_names WHERE local_language_id=9')}
    genera = localized(db, 'pokemon_species_names', 'pokemon_species_id', 'genus')
    forms = {}
    for row in db.execute('SELECT * FROM pokemon_forms ORDER BY is_default DESC, form_order'):
        forms.setdefault(row['pokemon_id'], dict(row))
    form_names = localized(db, 'pokemon_form_names', 'pokemon_form_id', 'form_name')
    version_orders = {row['id']: row['order'] for row in db.execute('SELECT * FROM version_groups')}
    grouped = {}
    for table, key in [('pokemon_types', 'types'), ('pokemon_stats', 'stats'),
                       ('pokemon_types_past', 'pastTypes'), ('pokemon_stats_past', 'pastStats'),
                       ('pokemon_abilities', 'abilities'), ('pokemon_abilities_past', 'pastAbilities')]:
        data = defaultdict(list)
        for row in db.execute(f'SELECT * FROM {table}'):
            data[row['pokemon_id']].append(dict(row))
        grouped[key] = data
    db.execute('CREATE TABLE dex_entries (id INTEGER PRIMARY KEY, species_id INTEGER, generation INTEGER, is_default INTEGER, name TEXT, payload TEXT)')
    for row in db.execute('SELECT * FROM pokemon ORDER BY species_id, is_default DESC, id').fetchall():
        poke = dict(row)
        sp = species[poke['species_id']]
        form = forms.get(poke['id'], {})
        form_name = form_names.get(form.get('id'), '') if not poke['is_default'] else ''
        if not poke['is_default'] and not form_name:
            # Keep a truthful source name when this particular form has no Chinese translation.
            form_name = form.get('form_identifier', '') or poke['identifier']
        record = {
            'id': poke['id'], 'speciesId': sp['id'], 'name': names[sp['id']],
            'englishName': english.get(sp['id'], sp['identifier']),
            'identifier': poke['identifier'], 'formName': form_name,
            'generation': sp['generation_id'], 'isDefault': bool(poke['is_default']),
            'introducedOrder': version_orders.get(form.get('introduced_in_version_group_id'), 0),
            'height': poke['height'] / 10, 'weight': poke['weight'] / 10,
            'genus': genera.get(sp['id'], ''), 'genderRate': sp['gender_rate'],
            'captureRate': sp['capture_rate'], 'happiness': sp['base_happiness'],
            'hatchCounter': sp['hatch_counter'], 'growthRateId': sp['growth_rate_id'],
            'isLegendary': bool(sp['is_legendary']), 'isMythical': bool(sp['is_mythical']),
            'isBaby': bool(sp['is_baby']), 'chainId': sp['evolution_chain_id'],
            'parentSpeciesId': sp['evolves_from_species_id'], 'images': images[poke['id']],
            **{key: grouped[key].get(poke['id'], []) for key in grouped},
        }
        db.execute('INSERT INTO dex_entries VALUES (?,?,?,?,?,?)', (
            poke['id'], sp['id'], sp['generation_id'], poke['is_default'], names[sp['id']],
            json.dumps(record, ensure_ascii=False, separators=(',', ':'))))
    db.execute('CREATE INDEX idx_dex_species ON dex_entries(species_id)')
    db.row_factory = None


def write_item_generations(csv_root, data_dir):
    generations = defaultdict(set)
    for row in read_csv(csv_root, 'item_game_indices'):
        generation = int(row['generation_id'])
        if 1 <= generation <= 9:
            generations[generation].add(int(row['item_id']))
    payload = {'schemaVersion': 1, 'source': 'PokéAPI item_game_indices.csv',
               'generations': {str(gen): sorted(ids) for gen, ids in sorted(generations.items())}}
    (data_dir / 'item-generations.json').write_text(
        json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=ROOT.parent / 'pokeapi')
    parser.add_argument('--item-metadata-only', action='store_true',
                        help='Only refresh item generation indices; leave SQLite and images unchanged.')
    args = parser.parse_args()
    source = args.source.resolve()
    csv_root = source / 'data/v2/csv'
    if not (csv_root / 'pokemon.csv').is_file():
        raise SystemExit(f'找不到 PokéAPI 数据：{csv_root}。使用 --source 指定仓库。')
    data_dir = ROOT / 'data'
    data_dir.mkdir(exist_ok=True)
    if args.item_metadata_only:
        write_item_generations(csv_root, data_dir)
        print('Ready: item-generations.json', flush=True)
        return
    temp_database = data_dir / 'pokedex.build.sqlite'
    temp_database.unlink(missing_ok=True)
    counts = {}
    with sqlite3.connect(temp_database) as db:
        db.execute('PRAGMA journal_mode=OFF')
        db.execute('PRAGMA synchronous=OFF')
        for table in TABLES:
            counts[table] = import_table(db, csv_root, table)
        db.execute('CREATE INDEX idx_learnset ON pokemon_moves(pokemon_id, version_group_id)')
        db.execute('CREATE INDEX idx_move_language ON move_flavor_text(move_id, language_id, version_group_id)')
        db.execute('CREATE INDEX idx_ability_language ON ability_flavor_text(ability_id, language_id, version_group_id)')
        db.execute('CREATE INDEX idx_item_language ON item_flavor_text(item_id, language_id, version_group_id)')
        images, image_counts = copy_assets(db, source, ROOT / 'public/assets')
        build_catalog(db, images)
        species_count = db.execute('SELECT COUNT(*) FROM pokemon_species').fetchone()[0]
        chinese_count = db.execute('SELECT COUNT(*) FROM pokemon_species_names WHERE local_language_id=12').fetchone()[0]
        missing_artwork = [row[0] for row in db.execute('SELECT id FROM pokemon WHERE is_default=1') if not images[row[0]].get('artwork')]
        move_versions = dict(db.execute('SELECT version_group_id, COUNT(*) FROM pokemon_moves GROUP BY version_group_id'))
        db.commit()
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('SQLite integrity check failed')
    db.close()
    temp_database.replace(data_dir / 'pokedex.sqlite')
    write_item_generations(csv_root, data_dir)
    manifest = {
        'schemaVersion': 1, 'importedAt': datetime.now(timezone.utc).isoformat(),
        'speciesCount': species_count, 'chineseNameCount': chinese_count,
        'pokemonCount': counts['pokemon'], 'moveCount': counts['moves'],
        'abilityCount': counts['abilities'], 'itemCount': counts['items'],
        'imageCounts': image_counts, 'learnsetVersionCounts': move_versions,
    }
    (data_dir / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    (data_dir / 'import-report.json').write_text(json.dumps({
        **manifest, 'source': str(source), 'tableCounts': counts,
        'missingDefaultArtwork': missing_artwork,
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    for src, target in [
        (source / 'LICENSE.md', 'POKEAPI-LICENSE.md'),
        (source / 'data/v2/sprites/LICENCE.txt', 'SPRITES-LICENCE.txt'),
    ]:
        if src.is_file():
            shutil.copyfile(src, data_dir / target)
    print(f'Ready: {species_count} species, {chinese_count} Chinese names. {data_dir / "pokedex.sqlite"}', flush=True)


if __name__ == '__main__':
    main()
