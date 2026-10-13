import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createGame, rerollOffers, chooseAugment, buyItem, sellItem,
  playRound, TEXT_GAME_STRATEGIES,
} from '../src/text-game-engine.js';

const read = name => JSON.parse(readFileSync(new URL(`../public/data/${name}.json`, import.meta.url)));
const db = { champions: read('champions'), augments: read('augments'), items: read('items') };
const start = (seed = 103, initialItemIds = []) => createGame({ championId: 'Yasuo', db, seed, initialItemIds });

test('seeded matchmaking and three-card drafts repeat, while roster has ten unique champions', () => {
  const a = start('share-this-seed');
  const b = start('share-this-seed');
  assert.deepEqual(a, b);
  const roster = [a.player, ...a.allies, ...a.enemies].map(unit => unit.championId);
  assert.equal(new Set(roster).size, 10);
  assert.equal(a.allies.length, 4);
  assert.equal(a.enemies.length, 5);
  assert.equal(a.player.level, 1);
  assert.deepEqual(a.player.augmentIds, []);
  assert.equal(a.offers.length, 3);
  assert.ok(a.offers.every(card => card.rarity === a.offerRarity));
});

test('one reroll replaces all three options without repeats and never mutates the prior state', () => {
  const before = start();
  const firstIds = new Set(before.offers.map(card => card.id));
  const after = rerollOffers(before, db);
  assert.equal(before.rerollsRemaining, 1);
  assert.equal(after.rerollsRemaining, 0);
  assert.equal(after.offerRarity, before.offerRarity);
  assert.ok(after.offers.every(card => !firstIds.has(card.id)));
  assert.throws(() => rerollOffers(after, db), /刷新次数/);
  assert.throws(() => chooseAugment(before, '__not-offered__', db), /当前三张/);
  const chosen = chooseAugment(after, after.offers[0].id, db);
  assert.equal(chosen.phase, 'shop');
  assert.deepEqual(chosen.player.augmentIds, [after.offers[0].id]);
  assert.deepEqual(before.player.augmentIds, []);
});

test('the configured build enters as gear, and shop spending, sale and panel health are traceable', () => {
  let game = start(33, ['3078', '3031', '3046']);
  assert.deepEqual(game.player.itemIds, ['3078', '3031', '3046']);
  assert.deepEqual(game.player.augmentIds, []);
  game = chooseAugment(game, game.offers[0].id, db);
  const oldHp = game.player.maxHp;
  const oldGold = game.player.gold;
  const steel = db.items.find(item => item.id === '3084');
  const bought = buyItem(game, '3084', db);
  assert.equal(bought.player.gold, oldGold - steel.gold);
  assert.ok(bought.player.maxHp > oldHp);
  assert.equal(game.player.itemIds.includes('3084'), false);
  assert.throws(() => buyItem(bought, '3084', db), /只能购买一件/);
  const sold = sellItem(bought, '3084', db);
  assert.equal(sold.player.gold, bought.player.gold + Math.floor(steel.gold * .7));
  assert.equal(sold.player.itemIds.includes('3084'), false);
});

test('heartsteel combat strategy stacks permanent health for subsequent rounds', () => {
  let game = start(22, ['3084']);
  game = chooseAugment(game, game.offers[0].id, db);
  const battle = playRound(game, 'heartsteel', db);
  assert.ok(battle.lastRound.heartsteelStacks > 0);
  assert.equal(battle.player.growth['3084'], battle.lastRound.heartsteelStacks * 30);
  assert.ok(battle.player.maxHp > game.player.maxHp);
  const quest = { ...game, player: { ...game.player, augmentIds: ['quest_steel_your_heart'] } };
  const questBattle = playRound(quest, 'heartsteel', db);
  assert.equal(questBattle.lastRound.heartsteelHealthGained, questBattle.lastRound.heartsteelStacks * 45);
  assert.ok(questBattle.player.growth['3084'] > battle.player.growth['3084']);
});

test('other champions enter with a matching gear tier and progress one item per round', () => {
  let geared = start(22, ['3078', '3031', '3046']);
  geared = playRound(chooseAugment(geared, geared.offers[0].id, db), 'frontline', db);
  assert.ok([...geared.allies, ...geared.enemies].every(unit => unit.itemIds.length === 3));

  let empty = start(22);
  empty = playRound(chooseAugment(empty, empty.offers[0].id, db), 'frontline', db);
  assert.ok([...empty.allies, ...empty.enemies].every(unit => unit.itemIds.length === 0));
  empty = playRound(chooseAugment(empty, empty.offers[0].id, db), 'frontline', db);
  assert.ok([...empty.allies, ...empty.enemies].every(unit => unit.itemIds.length === 1));
});

test('other growth augments and Rod of Ages advance between teamfights', () => {
  let game = start(41, ['6657']);
  game = chooseAugment(game, game.offers[0].id, db);
  game = { ...game, player: { ...game.player, augmentIds: ['phenomenal_evil', 'infinite_recursion'] } };
  const after = playRound(game, 'frontline', db);
  assert.ok(after.player.growth.phenomenal_evil >= 2);
  assert.equal(after.player.growth.infinite_recursion, Math.min(5, after.lastRound.allyKills));
  assert.equal(after.player.growth['6657'], 3);
  assert.ok(after.log.some(entry => entry.text.includes('时光之杖推进')));
});

test('choices change battle records; four teamfights produce a final win/loss', () => {
  let game = start(123);
  game = chooseAugment(game, game.offers[0].id, db);
  const backline = playRound(game, 'backline', db);
  const frontline = playRound(game, 'frontline', db);
  const equipped = playRound(buyItem(game, '3078', db), 'backline', db);
  assert.notEqual(backline.lastRound.playerDamage, frontline.lastRound.playerDamage);
  assert.notEqual(backline.lastRound.playerDamage, equipped.lastRound.playerDamage);
  assert.match(backline.lastRound.events[0], /突袭后排/);
  assert.match(frontline.lastRound.events[0], /攻击前排/);
  assert.ok(TEXT_GAME_STRATEGIES.some(strategy => strategy.id === 'backline'));
  assert.equal(game.phase, 'shop');
  let complete = game;
  const seen = new Set(start(123).offers.map(card => card.id));
  for (let round = 1; round <= 4; round++) {
    if (round > 1) {
      assert.equal(complete.phase, 'draft');
      assert.ok(complete.offers.every(card => !seen.has(card.id)));
      complete.offers.forEach(card => seen.add(card.id));
      complete = chooseAugment(complete, complete.offers[0].id, db);
    }
    complete = playRound(complete, 'frontline', db);
  }
  assert.equal(complete.phase, 'finished');
  assert.equal(complete.rounds.length, 4);
  assert.equal(complete.player.augmentIds.length, 4);
  assert.equal(complete.score.ally + complete.score.enemy, 4);
  assert.ok(['ally', 'enemy'].includes(complete.result.winner));
  assert.throws(() => playRound(complete, 'frontline', db), /备战后/);
});
