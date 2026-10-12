#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw
curl -fsSL 'https://ddragon.leagueoflegends.com/cdn/16.20.1/data/zh_CN/champion.json' -o data/raw/champion.json
curl -fsSL 'https://ddragon.leagueoflegends.com/cdn/16.20.1/data/zh_CN/item.json' -o data/raw/item.json
curl -fsSL 'https://raw.communitydragon.org/latest/cdragon/arena/zh_cn.json' -o data/raw/arena-zh-cn.json
curl -fsSL 'https://arammayhem.com/data/v1/26-20/augments.json' -o data/raw/mayhem-augments.json
curl -fsSL 'https://arammayhem.com/data/v1/latest/items.json' -o data/raw/mayhem-items.json
python3 scripts/build-data.py
