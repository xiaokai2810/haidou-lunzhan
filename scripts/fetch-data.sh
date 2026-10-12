#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw

# Keep these three versions together. Mayhem uses 26.xx while Data Dragon and
# CommunityDragon use 16.xx for the same 2026 League patch.
dd_version='16.20.1'
mayhem_patch='26.20'
mayhem_slug='26-20'
cdragon_patch='16.20'

curl -fsSL "https://ddragon.leagueoflegends.com/cdn/${dd_version}/data/zh_CN/champion.json" -o data/raw/champion.json
curl -fsSL "https://ddragon.leagueoflegends.com/cdn/${dd_version}/data/zh_CN/item.json" -o data/raw/item.json
curl -fsSL "https://raw.communitydragon.org/${cdragon_patch}/cdragon/arena/zh_cn.json" -o data/raw/arena-zh-cn.json
curl -fsSL 'https://arammayhem.com/data/v1/index.json' -o data/raw/mayhem-index.json
curl -fsSL "https://arammayhem.com/data/v1/${mayhem_slug}/augments.json" -o data/raw/mayhem-augments.json
# The item catalog has no patch-scoped URL. Reject it unless its release ID
# matches the patch-scoped augment file and the live index.
curl -fsSL 'https://arammayhem.com/data/v1/latest/items.json' -o data/raw/mayhem-items.json

MAYHEM_EXPECT_DD="$dd_version" MAYHEM_EXPECT_PATCH="$mayhem_patch" python3 - <<'PY'
import json
import os
from pathlib import Path

raw = Path('data/raw')
def read(name):
    return json.loads((raw / name).read_text())

dd_champions = read('champion.json')
dd_items = read('item.json')
index = read('mayhem-index.json')
augments = read('mayhem-augments.json')
items = read('mayhem-items.json')
expected_dd = os.environ['MAYHEM_EXPECT_DD']
expected_patch = os.environ['MAYHEM_EXPECT_PATCH']
if dd_champions['version'] != expected_dd or dd_items['version'] != expected_dd:
    raise SystemExit('Data Dragon files do not match the pinned version')
if index['latestPatch'] != expected_patch or augments['meta']['patch'] != expected_patch:
    raise SystemExit('Mayhem patch moved: update pinned versions before building')
if len({index['releaseId'], augments['meta']['releaseId'], items['meta']['releaseId']}) != 1:
    raise SystemExit('Mayhem index, augments and item catalog have different release IDs')
PY

MAYHEM_FETCH_EFFECTS=1 python3 scripts/build-data.py
