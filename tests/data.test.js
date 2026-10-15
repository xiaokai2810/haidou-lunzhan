import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const meta = read('public/data/meta.json');
const champions = read('public/data/champions.json');
const items = read('public/data/items.json');
const augments = read('public/data/augments.json');

test('the published snapshot metadata matches every shipped catalog', () => {
  assert.match(meta.patch, /^\d{2}\.\d{1,2}$/);
  assert.match(meta.ddragonVersion, /^\d{2}\.\d{1,2}\.\d+$/);
  assert.match(meta.statsDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(meta.releaseId);
  assert.deepEqual(meta.counts, {
    champions: champions.length,
    items: items.length,
    augments: augments.length,
  });
  assert.ok(champions.every(c => c.icon.includes(`/cdn/${meta.ddragonVersion}/`)));
  assert.ok(items.every(i => i.icon.includes(`/cdn/${meta.ddragonVersion}/`)));
  const cdragonPatch = `${Number(meta.patch.split('.')[0]) - 10}.${meta.patch.split('.')[1]}`;
  assert.equal(meta.ddragonVersion.split('.').slice(0,2).join('.'), cdragonPatch);
  assert.ok(meta.sources.augments.includes(`/${meta.patch.replace('.', '-')}/augments.json`));
  assert.ok(meta.sources.communityDragon.includes(`/${cdragonPatch}/`));
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

test('the Mayhem shop includes components and only currently purchasable entries', () => {
  const byId = new Map(items.map(item => [item.id, item]));
  assert.equal(byId.size, items.length);
  assert.ok(items.length >= 190);
  assert.deepEqual(
    new Set(items.map(item => item.category)),
    new Set(['legendary', 'component', 'starter', 'boots', 'consumable', 'evolved', 'special']),
  );
  assert.ok(items.every(item => typeof item.purchasable === 'boolean'));
  assert.ok(items.every(item => Array.isArray(item.from) && Array.isArray(item.into)));
  assert.ok(items.every(item => item.from.every(id => typeof id === 'string')));
  assert.ok(items.every(item => item.into.every(id => typeof id === 'string')));
  assert.ok(items.every(item => item.gold >= 0));
  assert.ok(items.filter(item => item.category === 'component').length >= 50);
  for (const item of items.filter(item => item.purchasable && item.from.length)) {
    assert.ok(item.from.every(id => byId.has(id)), `${item.name} has an unavailable recipe component`);
  }
  if (meta.patch !== '26.20') return;
  assert.equal(byId.get('3095')?.name, '岚切');
  assert.ok(!byId.has('3097'));
  assert.ok(!byId.has('2520')); // Bastionbreaker was disabled on ARAM.
  assert.ok(!byId.has('6701'));
  assert.ok(!byId.has('3002'));
  assert.equal(byId.get('2522')?.gold, 2800); // Riot's 26.3 price, not stale catalog cost.
  for (const id of ['2530', '3121', '3040', '3042', '994403', '228002']) {
    assert.equal(byId.get(id)?.purchasable, false);
  }
});
