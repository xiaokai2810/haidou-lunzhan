import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const meta = read('public/data/meta.json');
const champions = read('public/data/champions.json');
const items = read('public/data/items.json');
const augments = read('public/data/augments.json');
const rawAugments = read('data/raw/mayhem-augments.json');
const rawItems = read('data/raw/mayhem-items.json');

test('the published snapshot uses one patch and one Mayhem release', () => {
  assert.equal(meta.ddragonVersion, read('data/raw/champion.json').version);
  assert.equal(meta.ddragonVersion, read('data/raw/item.json').version);
  assert.equal(meta.patch, rawAugments.meta.patch);
  assert.equal(meta.statsDate, rawAugments.meta.statsDate);
  assert.equal(meta.releaseId, rawAugments.meta.releaseId);
  assert.equal(meta.releaseId, rawItems.meta.releaseId);
  assert.deepEqual(meta.counts, {
    champions: champions.length,
    items: items.length,
    augments: augments.length,
  });
  assert.ok(champions.every(c => c.icon.includes(`/cdn/${meta.ddragonVersion}/`)));
  assert.ok(items.every(i => i.icon.includes(`/cdn/${meta.ddragonVersion}/`)));
  const cdragonPatch = `${Number(meta.patch.split('.')[0]) - 10}.${meta.patch.split('.')[1]}`;
  assert.ok(augments.every(a => !a.icon ||
    a.icon.startsWith(`https://raw.communitydragon.org/${cdragonPatch}/game/`) ||
    a.icon.startsWith('https://arammayhem.com/augments/')));
});

test('published effect text omits live counters and known incorrect cooldowns', () => {
  assert.ok(augments.every(a => !a.effect.includes('当前对局数值')));
  assert.ok(augments.every(a => !a.effect.includes('这个效果有0秒冷却时间')));
  if (meta.patch !== '26.20') return;
  const byId = Object.fromEntries(augments.map(a => [a.id, a]));
  assert.match(byId.triggered_inferno.effect, /5秒冷却时间/);
  assert.match(byId.squishy_slappy_grab.effect, /30秒冷却时间/);
  assert.doesNotMatch(byId.spell_split.effect, /在命中时/);
  assert.match(byId.shrink_engine.effect, /10 技能急速和 2%/);
});
