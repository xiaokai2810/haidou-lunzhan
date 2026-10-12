#!/usr/bin/env python3
"""Build a compact, pinned 16.20 client dataset from the downloaded public sources."""
import concurrent.futures
import html
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data' / 'raw'
OUT = ROOT / 'public' / 'data'
OUT.mkdir(parents=True, exist_ok=True)

def read(name):
    return json.loads((RAW / name).read_text())

def plain(s):
    s = re.sub(r'<br\s*/?>', ' · ', s or '', flags=re.I)
    s = re.sub(r'<[^>]+>', '', s)
    return re.sub(r'\s+', ' ', html.unescape(s)).strip()

champions = []
for c in read('champion.json')['data'].values():
    champions.append({
        'id': c['id'], 'key': c['key'], 'name': c['name'], 'title': c['title'],
        'tags': c['tags'], 'stats': c['stats'],
        'icon': f"https://ddragon.leagueoflegends.com/cdn/16.20.1/img/champion/{c['id']}.png",
        'splash': f"https://ddragon.leagueoflegends.com/cdn/img/champion/splash/{c['id']}_0.jpg",
    })

dd_items = read('item.json')['data']
mayhem_items = read('mayhem-items.json')['rows']
items = []
seen = set()
for row in mayhem_items:
    item_id = row.get('gameItemId')
    source = dd_items.get(str(item_id))
    if not item_id or not source or item_id in seen:
        continue
    # Full items and boots. The mode catalog is the availability gate.
    if row.get('category') != 'legendary' and (row.get('cost') or 0) < 2200 and not row.get('category', '').startswith('boots'):
        continue
    seen.add(item_id)
    stat_block = re.search(r'<stats>(.*?)</stats>', source.get('description', ''), re.S)
    stat_text = plain(stat_block.group(1)) if stat_block else ''
    def listed(pattern):
        match = re.search(pattern, stat_text)
        return float(match.group(1)) if match else 0
    extras = {
        'haste': listed(r'(\d+(?:\.\d+)?)\s*技能急速'),
        'lethality': listed(r'(\d+(?:\.\d+)?)\s*穿甲'),
        'magicPen': listed(r'(\d+(?:\.\d+)?)\s*法术穿透'),
        'armorPenPct': listed(r'(\d+(?:\.\d+)?)%\s*护甲穿透'),
        'magicPenPct': listed(r'(\d+(?:\.\d+)?)%\s*法术穿透'),
        'critPct': listed(r'(\d+(?:\.\d+)?)%\s*暴击几率'),
        'moveFlat': listed(r'(\d+(?:\.\d+)?)\s*移动速度'),
    }
    items.append({
        'id': item_id, 'name': source['name'], 'english': row['name']['en'],
        'category': 'boots' if row.get('category', '').startswith('boots') else 'legendary',
        'tags': source.get('tags', []), 'gold': source['gold']['total'],
        'stats': source.get('stats', {}), 'extras': extras,
        'description': plain(source.get('description', '')),
        'icon': f'https://ddragon.leagueoflegends.com/cdn/16.20.1/img/item/{item_id}.png',
    })

arena = {a['name']: a for a in read('arena-zh-cn.json')['augments']}
def fetch_effect(row):
    url = 'https://aramkit.cn/zh-CN/augments/' + row['slug']
    try:
        req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as response:
            page = response.read().decode('utf-8', 'ignore')
        match = re.search(r'<div class="augment-effect-content".*?</div></div></div></div>', page)
        if match:
            return plain(match.group(0))[:700]
    except Exception:
        pass
    return ''

rows = [r for r in read('mayhem-augments.json')['rows'] if not r.get('retiredPatch')]
previous_path = OUT / 'augments.json'
previous = {a['id']: a for a in json.loads(previous_path.read_text())} if previous_path.exists() else {}
def cached_effect(row):
    old = previous.get(row['augmentId'])
    return old['effect'] if old and old.get('source') == 'ARAMKit' else fetch_effect(row)
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    effects = list(pool.map(cached_effect, rows))

augments = []
for row, effect in zip(rows, effects):
    a = arena.get(row['name']['zh-CN'])
    icon = ''
    if a and a.get('iconSmall'):
        icon = 'https://raw.communitydragon.org/latest/game/' + a['iconSmall'].lower()
    augments.append({
        'id': row['augmentId'], 'slug': row['slug'], 'name': row['name']['zh-CN'],
        'english': row['name']['en'], 'rarity': row['rarity'],
        'pickRate': row.get('pickRate'), 'effect': effect or (plain(a.get('desc','')) if a else ''),
        'icon': icon, 'source': 'ARAMKit' if effect else ('CommunityDragon' if a else 'catalog'),
    })

for name, data in [('champions', champions), ('items', items), ('augments', augments)]:
    (OUT / f'{name}.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
    print(name, len(data))
print('augment effect coverage', sum(bool(a['effect']) for a in augments), '/', len(augments))
