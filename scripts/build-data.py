#!/usr/bin/env python3
"""Build a version-checked ARAM Mayhem snapshot from local raw data."""
import concurrent.futures
import html
import json
import os
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

dd_champions = read('champion.json')
dd_items_file = read('item.json')
mayhem_index = read('mayhem-index.json')
mayhem_augments = read('mayhem-augments.json')
mayhem_items = read('mayhem-items.json')
arena_data = read('arena-zh-cn.json')
dd_version = dd_champions['version']
patch = mayhem_augments['meta']['patch']
release_id = mayhem_augments['meta']['releaseId']
if dd_items_file['version'] != dd_version:
    raise ValueError('Data Dragon champion/item versions do not match')
if int(dd_version.split('.')[0]) != int(patch.split('.')[0]) - 10 or dd_version.split('.')[1] != patch.split('.')[1]:
    raise ValueError(f'Data Dragon {dd_version} and Mayhem patch {patch} do not match')
if mayhem_index['latestPatch'] != patch or mayhem_index['releaseId'] != release_id:
    raise ValueError('Mayhem index and augment snapshot do not match')
if mayhem_items['meta']['releaseId'] != release_id:
    raise ValueError('Mayhem item catalog and augment snapshot do not match')
dd_root = f'https://ddragon.leagueoflegends.com/cdn/{dd_version}'
cdragon_patch = '.'.join(dd_version.split('.')[:2])
cdragon_root = f'https://raw.communitydragon.org/{cdragon_patch}'

champions = []
for c in dd_champions['data'].values():
    champions.append({
        'id': c['id'], 'key': c['key'], 'name': c['name'], 'title': c['title'],
        'tags': c['tags'], 'stats': c['stats'],
        'icon': f"{dd_root}/img/champion/{c['id']}.png",
        'splash': f"https://ddragon.leagueoflegends.com/cdn/img/champion/splash/{c['id']}_0.jpg",
    })

dd_items = dd_items_file['data']
items = []
seen = set()
for row in mayhem_items['rows']:
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
        'icon': f'{dd_root}/img/item/{item_id}.png',
    })

def normalized(value):
    return re.sub(r'[^a-z0-9]', '', value.lower())

arena = {a['name']: a for a in arena_data['augments']}
arena_by_api = {normalized(a['apiName']): a for a in arena_data['augments']}
arena_by_icon = {
    normalized(a['iconSmall'].split('/')[-1].removesuffix('_small.png')): a
    for a in arena_data['augments'] if a.get('iconSmall')
}

# These exact image URLs were checked on arammayhem.com for the 26.20 catalog.
# Do not synthesize URLs for other IDs: several similarly named files are absent.
verified_mayhem_icons = {
    'shrink_engine', 'warlock_juicebox', 'tooth_fairy', 'critical_missile', 'twin_fire', 'upgrade_infinity_edge', 'archmage', 'forged_by_the_master',
    'upgrade_collector', 'infinite_recursion', 'zealot', 'scopier_weapons', 'donation', 'critical_rhythm', 'biggest_snowball_ever', 'endless_decimation',
    'final_form', 'ultimate_awakening', 'ravenous_bind', 'scoped_weapons', 'upgrade_immolate', 'siphon', 'from_downtown', 'upgrade_sheen',
    'growth_spurt', 'double_tap', 'overloaded', 'high_roller', 'triggered_inferno', 'juiced', 'yowch_my_coins', 'kill_secured',
    'soul_eater', 'stay_resolute', 'cruelty', 'ominous_pact', 'chain_reaction', 'en_passant', 'goldrend', 'our_healing',
    'adaptive_ward', 'stuck_in_here_with_me', 'pin_cushion', 'glass_cannon', 'sonata', 'king_me', 'surge_field', 'mighty_shield',
    'spin_me_right_round', 'wee_woo_wee_woo', 'empowered_by_the_faithful', 'protein_shake', 'empyrean_promise', 'flashbang', 'flash_2',
}

def clean_effect(value, augment_id):
    effect = plain(value)
    # Riot's 26.20 notes explicitly give these cooldowns. Other apparent zero
    # cooldowns from dynamic tooltip text are omitted rather than invented.
    official_cooldowns = {'triggered_inferno': 5, 'squishy_slappy_grab': 30} if patch == '26.20' else {}
    if augment_id in official_cooldowns:
        effect = effect.replace('这个效果有0秒冷却时间。', f"这个效果有{official_cooldowns[augment_id]}秒冷却时间。")
    else:
        effect = effect.replace('这个效果有0秒冷却时间。', '')
    if patch == '26.20' and augment_id == 'spell_split':
        effect = effect.replace('在命中时、最大距离时或再次施放时', '在飞弹结束或再次施放时')
    if patch == '26.20' and augment_id == 'shrink_engine':
        # The current Mayhem description differs from the old ARAMKit tooltip.
        effect = '参与击杀获得 1 层，每层提供 10 技能急速和 2% 额外移动速度，同时体型缩小 4%。阵亡时损失 65% 层数；体型缩小最多 80%（20 层）。'
    effect = effect.replace('（N 为本局实时累计值）', '').replace('当前对局数值', 'N')
    effect = re.sub(r'已造成的伤害：N炼狱扳机\s*触发次数：N', '', effect)
    # In-game tracking counters are not part of an augment's rules.
    effect = re.sub(r'(?:已[^。！？，,：]{1,20}|(?:额外|最大|总|最小|当前|重置|触发|反弹|被)[^。！？，,：]{1,16}|伤害|治疗|护盾)[：:]N%?', '', effect)
    if 'N' in effect:
        effect += '（N 为本局实时累计值）'
    return effect.strip()

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

rows = [r for r in mayhem_augments['rows'] if not r.get('retiredPatch')]
previous_path = OUT / 'augments.json'
previous_meta_path = OUT / 'meta.json'
previous_meta = json.loads(previous_meta_path.read_text()) if previous_meta_path.exists() else {}
same_patch_cache = previous_meta.get('patch') == patch and previous_meta.get('releaseId') == release_id
previous = {a['id']: a for a in json.loads(previous_path.read_text())} if same_patch_cache and previous_path.exists() else {}
allow_fetch = os.environ.get('MAYHEM_FETCH_EFFECTS') == '1'
def cached_effect(row):
    old = previous.get(row['augmentId'])
    if old and old.get('source') == 'ARAMKit' and old.get('effect'):
        return old['effect']
    return fetch_effect(row) if allow_fetch else ''
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    effects = list(pool.map(cached_effect, rows))

augments = []
for row, effect in zip(rows, effects):
    a = (arena.get(row['name']['zh-CN'])
         or arena_by_api.get(normalized(row['augmentId']))
         or arena_by_icon.get(normalized(row['augmentId'])))
    icon = ''
    if a and a.get('iconSmall'):
        icon = f"{cdragon_root}/game/{a['iconSmall'].lower()}"
    elif patch == '26.20' and row['augmentId'] in verified_mayhem_icons:
        image_name = '_'.join(part.capitalize() for part in row['augmentId'].split('_'))
        icon = f'https://arammayhem.com/augments/{image_name}_mayhem_augment.webp'
    augments.append({
        'id': row['augmentId'], 'slug': row['slug'], 'name': row['name']['zh-CN'],
        'english': row['name']['en'], 'rarity': row['rarity'],
        'pickRate': row.get('pickRate'),
        'effect': clean_effect(effect or (a.get('desc', '') if a else ''), row['augmentId']),
        'icon': icon, 'source': 'ARAMKit' if effect else ('CommunityDragon' if a else 'catalog'),
    })

metadata = {
    'patch': patch,
    'ddragonVersion': dd_version,
    'statsDate': mayhem_augments['meta']['statsDate'],
    'releaseId': release_id,
    'generatedAt': mayhem_index['generatedAt'],
    'sources': {
        'champions': f'{dd_root}/data/zh_CN/champion.json',
        'items': f'{dd_root}/data/zh_CN/item.json',
        'augments': f'https://arammayhem.com/data/v1/{patch.replace(".", "-")}/augments.json',
        'itemCatalog': 'https://arammayhem.com/data/v1/latest/items.json',
        'communityDragon': f'{cdragon_root}/cdragon/arena/zh_cn.json',
        'mayhemIcons': 'https://arammayhem.com/augments/',
        'patchNotes': f'https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-{patch.replace(".", "-")}-notes/',
    },
    'counts': {'champions': len(champions), 'items': len(items), 'augments': len(augments)},
}

for name, data in [('champions', champions), ('items', items), ('augments', augments), ('meta', metadata)]:
    (OUT / f'{name}.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
    print(name, len(data) if isinstance(data, list) else metadata['patch'])
print('augment effect coverage', sum(bool(a['effect']) for a in augments), '/', len(augments))
print('augment icon coverage', sum(bool(a['icon']) for a in augments), '/', len(augments))
