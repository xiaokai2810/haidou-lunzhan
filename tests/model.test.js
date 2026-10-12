import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { averageRecords, computeBuild } from '../src/model.js';

const read = name => JSON.parse(readFileSync(new URL(`../public/data/${name}.json`, import.meta.url)));
const champion = read('champions').find(x => x.id === 'Yasuo');
const items = read('items');
const augments = read('augments');
const item = id => items.find(x => x.id === id);
const augment = id => augments.find(x => x.id === id);
const build = changes => computeBuild({ champion, level: 18, items: [], augments: [], growth: {}, ...changes });

test('level curve reaches the listed level 18 growth total', () => {
  const one = build({ level: 1 });
  const eighteen = build({ level: 18 });
  assert.equal(one.stats.hp, champion.stats.hp);
  assert.equal(eighteen.stats.hp, champion.stats.hp + champion.stats.hpperlevel * 17);
});

test('item stats and modeled augment increase the corresponding panel values', () => {
  const base = build({});
  const equipped = build({ items: [item('3031')] });
  assert.equal(equipped.stats.ad - base.stats.ad, 75);
  assert.equal(equipped.stats.crit, 25);
  const empowered = build({ augments: [augment('draw_your_sword')] });
  assert.ok(empowered.stats.hp > base.stats.hp);
  assert.ok(empowered.stats.ad > base.stats.ad);
});

test('real match rows average only finite nonnegative end values', () => {
  const result = averageRecords([
    { id: 'phenomenal_evil', final_value: '80' },
    { id: 'phenomenal_evil', final_value: '100' },
    { id: 'phenomenal_evil', final_value: '-2' },
    { id: '3084', final_value: '500' },
  ]);
  assert.deepEqual(result.phenomenal_evil, { average: 90, count: 2 });
  assert.deepEqual(result['3084'], { average: 500, count: 1 });
});

test('growth values affect modeled output and target resistance lowers damage', () => {
  const growthAugment = augment('phenomenal_evil');
  const low = build({ augments: [growthAugment], growth: { phenomenal_evil: 20 }, targetMr: 0 });
  const high = build({ augments: [growthAugment], growth: { phenomenal_evil: 100 }, targetMr: 0 });
  assert.equal(high.stats.ap - low.stats.ap, 80);
  assert.ok(high.magicBurst > low.magicBurst);
  const armored = build({ targetArmor: 200 });
  assert.ok(armored.physicalDps < build({ targetArmor: 0 }).physicalDps);
});
