import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  counterModifier, createUnderfedBots, damageProfile,
  makeCombatant, simulateDuel, simulateOneVsFive,
} from '../src/battle-engine.js';

const read = name => JSON.parse(readFileSync(new URL(`../public/data/${name}.json`, import.meta.url)));
const champions = read('champions');
const items = read('items');
const augments = read('augments');
const champion = id => champions.find(row => row.id === id);
const item = id => items.find(row => row.id === id);
const build = (id, level = 18, selectedItems = []) => makeCombatant({
  champion: champion(id), level, items: selectedItems.map(item).filter(Boolean),
});

test('a documented hero interaction gives only a small traceable modifier', () => {
  const result = counterModifier(champion('Rammus'), champion('Ashe'));
  assert.ok(result.factor > 1 && result.factor <= 1.25);
  assert.ok(result.reasons.some(reason => reason.includes('拉莫斯')));
  assert.equal(counterModifier(champion('Ashe'), champion('Lux')).factor, 1);
});

test('resistances and equipment affect a duel, and identical builds draw', () => {
  const ashe = build('Ashe');
  const armored = build('Rammus', 18, ['3075', '3082']);
  const bare = build('Lux');
  assert.ok(damageProfile(ashe, armored).physical < damageProfile(ashe, bare).physical);
  assert.equal(simulateDuel(ashe, ashe).winner, 'draw');
  const geared = build('Ashe', 18, ['3031', '3046', '3153']);
  assert.equal(simulateDuel(geared, ashe).winner, 'left');
});

test('an augment damage penalty also applies inside the combat simulator', () => {
  const defender = build('Lux');
  const base = build('Yasuo');
  const reduced = makeCombatant({ champion:champion('Yasuo'), level:18, items:[], augments:[augments.find(a=>a.id==='celestial_body')] });
  assert.ok(damageProfile(reduced,defender).total < damageProfile(base,defender).total);
});

test('1v5 uses five unique underfed bots and a stronger build can change the outcome', () => {
  const roster = ['Lux', 'Ashe', 'Teemo', 'Sona', 'Garen'].map(champion);
  const bots = createUnderfedBots(roster, 18, items);
  assert.ok(bots.every(bot => bot.level === 14 && bot.items.length === 1 && bot.augments.length === 0));
  const weak = simulateOneVsFive(build('Yasuo'), bots);
  const strongPlayer = build('Yasuo', 18, ['3078', '3031', '3046']);
  const strong = simulateOneVsFive(strongPlayer, bots);
  assert.equal(weak.winner, 'bots');
  assert.equal(strong.winner, 'player');
  assert.equal(strong.defeated, 5);
  assert.throws(() => simulateOneVsFive(strongPlayer, [bots[0], bots[0], ...bots.slice(2)]), /五名不同/);
});
