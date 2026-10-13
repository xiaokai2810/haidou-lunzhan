import { clamp, computeBuild } from './model.js';
import { damageProfile } from './battle-engine.js';

// 文字游戏规则。公开目录的 pickRate 是玩家选取率，不是游戏发牌概率。
// 因此稀有度等概率抽样，pickRate 只给同稀有度卡片一个很小的展示偏好。
const RARITIES = ['silver', 'gold', 'prismatic'];
const MILESTONES = [1, 7, 11, 15];
const STRATEGIES = new Set(['backline', 'frontline', 'heartsteel', 'protect_carry']);
const ROLES = ['Tank', 'Fighter', 'Mage', 'Marksman', 'Support'];
const ROLE_ITEMS = {
  Tank: ['3065', '3084', '3075', '3111', '3083', '3143'],
  Fighter: ['3078', '3053', '6333', '3065', '3047', '3074'],
  Mage: ['6655', '3089', '3135', '3020', '3157', '3137'],
  Marksman: ['3046', '3031', '3153', '3006', '3036', '3072'],
  Assassin: ['3142', '3147', '3036', '3006', '6696', '3814'],
  Support: ['2065', '3107', '3504', '3158', '3222', '3190'],
};
const MODELED_AUGMENTS = new Set([
  'draw_your_sword', 'blunt_force', 'witchful_thinking', 'goliath',
  'celestial_body', 'deft', 'recursion', 'infinite_recursion', 'phenomenal_evil',
]);

const clone = value => JSON.parse(JSON.stringify(value));
const byId = (rows, id) => rows.find(row => row.id === id);
const roleOf = champion => champion.tags.find(tag => ROLE_ITEMS[tag]) || 'Fighter';

function seedNumber(seed) {
  if (Number.isFinite(Number(seed))) return (Number(seed) >>> 0) || 0x6d2b79f5;
  let hash = 2166136261;
  for (const character of String(seed)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) || 0x6d2b79f5;
}

function random(game) {
  let x = game.rng >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  game.rng = x >>> 0;
  return game.rng / 0x100000000;
}

function chooseWeighted(game, candidates, weight) {
  const weighted = candidates.map(candidate => ({ candidate, value: Math.max(0.001, weight(candidate)) }));
  let position = random(game) * weighted.reduce((sum, entry) => sum + entry.value, 0);
  for (const entry of weighted) {
    position -= entry.value;
    if (position < 0) return entry.candidate;
  }
  return weighted.at(-1).candidate;
}

function drawOffers(game, db) {
  const excluded = new Set([...game.player.augmentIds, ...game.seenAugmentIds]);
  const cards = db.augments.filter(card => card.rarity === game.offerRarity && !excluded.has(card.id));
  if (cards.length < 3) throw new Error('当前稀有度的强化符文不足，无法三选一');
  const pool = [...cards];
  const result = [];
  for (let index = 0; index < 3; index++) {
    const chosen = chooseWeighted(game, pool, card => {
      const popularity = clamp(Number(card.pickRate) || 0, 0, 100);
      return 0.85 + popularity / 300;
    });
    result.push(chosen);
    pool.splice(pool.findIndex(card => card.id === chosen.id), 1);
    game.seenAugmentIds.push(chosen.id);
  }
  game.offers = result;
  return game;
}

function pickChampion(game, db, used, preferredRole) {
  let pool = db.champions.filter(champion => !used.has(champion.id) && champion.tags[0] === preferredRole);
  if (!pool.length) pool = db.champions.filter(champion => !used.has(champion.id) && champion.tags.includes(preferredRole));
  if (!pool.length) pool = db.champions.filter(champion => !used.has(champion.id));
  if (!pool.length) throw new Error('英雄目录不足，无法匹配十名不同英雄');
  const chosen = pool[Math.floor(random(game) * pool.length)];
  used.add(chosen.id);
  return chosen;
}

function makeUnit(championId, db, level, itemIds = [], gold = 0) {
  const champion = byId(db.champions, championId);
  const panel = computeBuild({ champion, level, augments: [], items: itemIds.map(id => byId(db.items, id)).filter(Boolean) });
  return {
    championId, level, hp: Math.round(panel.stats.hp), maxHp: Math.round(panel.stats.hp),
    gold, augmentIds: [], itemIds: [...itemIds], growth: {}, kills: 0, deaths: 0,
  };
}

function syncUnit(unit, db, refill = false) {
  const panel = panelFor(unit, db);
  const nextMax = Math.round(panel.stats.hp);
  unit.hp = refill ? nextMax : Math.min(unit.hp, nextMax);
  unit.maxHp = nextMax;
}

function panelFor(unit, db) {
  const champion = byId(db.champions, unit.championId);
  if (!champion) throw new Error(`找不到英雄 ${unit.championId}`);
  return computeBuild({
    champion, level: unit.level,
    augments: unit.augmentIds.map(id => byId(db.augments, id)).filter(Boolean),
    items: unit.itemIds.map(id => byId(db.items, id)).filter(Boolean),
    growth: unit.growth, targetArmor: 0, targetMr: 0,
  });
}

function combatant(unit, db) {
  const champion = byId(db.champions, unit.championId);
  return { champion, level: unit.level, panel: panelFor(unit, db) };
}

function nextOfferRarity(game) {
  game.offerRarity = RARITIES[Math.floor(random(game) * RARITIES.length)];
}

/** Start a serializable, seeded 5v5 story match. The four augment slots begin empty. */
export function createGame({ championId, db, seed = 1, initialItemIds = [] }) {
  if (!db?.champions?.length || !db?.augments?.length || !db?.items?.length) throw new Error('缺少英雄、装备或强化符文目录');
  if (!byId(db.champions, championId)) throw new Error('请选择有效的玩家英雄');
  // A configured build is an explicit head start in this story mode. The shop
  // remains useful for empty slots and selling/replacing existing items.
  const startingItems = [...new Set(initialItemIds)].filter(id => byId(db.items, id)).slice(0, 6);
  const game = {
    seed: String(seed), rng: seedNumber(seed), phase: 'draft', round: 1, maxRounds: 4,
    baselineGear: startingItems.length,
    player: makeUnit(championId, db, MILESTONES[0], startingItems, 3500),
    allies: [], enemies: [], offers: [], offerRarity: null, seenAugmentIds: [],
    rerollsRemaining: 1, score: { ally: 0, enemy: 0 }, rounds: [], lastRound: null,
    log: [{ kind: 'system', round: 1, text: `匹配完成。四次强化选择分别在开局、7、11、15 级进行。${startingItems.length ? `赛前带入 ${startingItems.length} 件已配置装备。` : '本局从空装备开始。'}其他英雄按带入装备档位配装。` }],
    result: null,
  };
  const used = new Set([championId]);
  const playerRole = roleOf(byId(db.champions, championId));
  const friendlyRoles = ROLES.filter(role => role !== playerRole).slice(0, 4);
  while (friendlyRoles.length < 4) friendlyRoles.push('Assassin');
  for (const role of friendlyRoles) {
    const champion = pickChampion(game, db, used, role);
    game.allies.push(makeUnit(champion.id, db, MILESTONES[0]));
  }
  for (const role of ROLES) {
    const champion = pickChampion(game, db, used, role);
    game.enemies.push(makeUnit(champion.id, db, MILESTONES[0]));
  }
  nextOfferRarity(game);
  drawOffers(game, db);
  return game;
}

/** Replace the entire three-card offer once this draft; its rarity stays unchanged. */
export function rerollOffers(game, db) {
  if (game.phase !== 'draft') throw new Error('只能在强化选择阶段刷新');
  if (game.rerollsRemaining <= 0) throw new Error('本次选择的刷新次数已用完');
  const next = clone(game);
  next.rerollsRemaining -= 1;
  drawOffers(next, db);
  next.log.push({ kind: 'draft', round: next.round, text: '刷新了整组三张强化符文（文字游戏改编规则）。' });
  return next;
}

export function chooseAugment(game, id, db) {
  if (game.phase !== 'draft') throw new Error('当前不是强化选择阶段');
  const card = game.offers.find(offer => offer.id === id);
  if (!card || !byId(db.augments, id)) throw new Error('只能选择当前三张强化符文之一');
  const next = clone(game);
  next.player.augmentIds.push(id);
  next.phase = 'shop';
  next.offers = [];
  next.log.push({ kind: 'draft', round: next.round, text: `选择了${card.rarity === 'prismatic' ? '棱彩' : card.rarity === 'gold' ? '黄金' : '白银'}强化「${card.name}」。` });
  return next;
}

export function buyItem(game, itemId, db) {
  if (game.phase !== 'shop') throw new Error('只能在备战商店购买装备');
  const item = byId(db.items, itemId);
  if (!item) throw new Error('找不到这件装备');
  if (game.player.itemIds.length >= 6) throw new Error('装备栏已满，请先出售装备');
  if (game.player.itemIds.includes(itemId)) throw new Error('每种装备只能购买一件');
  if (game.player.gold < item.gold) throw new Error('金币不足');
  const next = clone(game);
  next.player.gold -= item.gold;
  next.player.itemIds.push(itemId);
  syncUnit(next.player, db, true);
  next.log.push({ kind: 'shop', round: next.round, text: `花费 ${item.gold} 金币购买「${item.name}」。` });
  return next;
}

export function sellItem(game, itemId, db) {
  if (game.phase !== 'shop') throw new Error('只能在备战商店出售装备');
  const item = byId(db.items, itemId);
  if (!item || !game.player.itemIds.includes(itemId)) throw new Error('未持有这件装备');
  const next = clone(game);
  const refund = Math.floor(item.gold * .7);
  next.player.itemIds.splice(next.player.itemIds.indexOf(itemId), 1);
  next.player.gold += refund;
  if (itemId === '3084') delete next.player.growth['3084'];
  syncUnit(next.player, db, true);
  next.log.push({ kind: 'shop', round: next.round, text: `出售「${item.name}」，获得 ${refund} 金币。` });
  return next;
}

function botItem(unit, round, baselineGear, db) {
  const champion = byId(db.champions, unit.championId);
  const plan = ROLE_ITEMS[roleOf(champion)] || ROLE_ITEMS.Fighter;
  const targetCount = Math.min(plan.length, baselineGear + round - 1);
  for (const id of plan.slice(0, targetCount)) {
    if (byId(db.items, id) && !unit.itemIds.includes(id)) unit.itemIds.push(id);
  }
}

function augmentProxy(game, db) {
  let attack = 1, defense = 1, healing = 1;
  let abstracted = 0;
  for (const id of game.player.augmentIds) {
    if (MODELED_AUGMENTS.has(id)) continue;
    const card = byId(db.augments, id);
    if (!card) continue;
    abstracted++;
    const description = `${card.name} ${card.effect || ''}`;
    const magnitude = card.rarity === 'prismatic' ? .035 : card.rarity === 'gold' ? .027 : .018;
    if (/护盾|治疗|生命|护甲|魔抗/.test(description)) defense += magnitude;
    else if (/加速|控制|眩晕|减速/.test(description)) healing += magnitude;
    else attack += magnitude;
  }
  return { attack: clamp(attack, 1, 1.15), defense: clamp(defense, 1, 1.15), healing: clamp(healing, 1, 1.15), abstracted };
}

const isBackline = fighter => fighter.champion.tags.some(tag => ['Marksman', 'Mage', 'Support'].includes(tag));
const isFrontline = fighter => fighter.champion.tags.some(tag => ['Tank', 'Fighter'].includes(tag));

function chooseTarget(game, attacker, defenders, strategy, playerAttack) {
  let best = null;
  let bestScore = -Infinity;
  for (let index = 0; index < defenders.length; index++) {
    const defender = defenders[index];
    if (defender.hp <= 0) continue;
    const hpRatio = defender.hp / defender.maxHp;
    let score = (1 - hpRatio) * 2;
    if (attacker.champion.tags.includes('Assassin') && isBackline(defender)) score += 1.3;
    else if (isFrontline(defender)) score += .7;
    if (playerAttack) {
      if (strategy === 'backline' && isBackline(defender)) score += 3;
      if ((strategy === 'frontline' || strategy === 'heartsteel') && isFrontline(defender)) score += 3;
      if (strategy === 'protect_carry' && defender.champion.tags.includes('Assassin')) score += 2;
    }
    score += random(game) * .22;
    if (score > bestScore) { best = index; bestScore = score; }
  }
  return best;
}

function simulateRound(game, strategy, db) {
  const allies = [game.player, ...game.allies].map(unit => {
    const combat = combatant(unit, db);
    return { ...combat, hp: combat.panel.stats.hp, maxHp: combat.panel.stats.hp, kills: 0, damage: 0 };
  });
  const enemies = game.enemies.map(unit => {
    const combat = combatant(unit, db);
    return { ...combat, hp: combat.panel.stats.hp, maxHp: combat.panel.stats.hp, kills: 0, damage: 0 };
  });
  const proxy = augmentProxy(game, db);
  let heartsteelStacks = 0;
  let elapsed = 0;
  let backlineHits = 0;
  let frontlineHits = 0;
  let playerDamageTaken = 0;
  let carryDamagePrevented = 0;
  const events = [];
  for (let tick = 0; tick < 72; tick++) {
    if (!allies.some(unit => unit.hp > 0) || !enemies.some(unit => unit.hp > 0)) break;
    const pendingAllies = Array(5).fill(0);
    const pendingEnemies = Array(5).fill(0);
    const killerAllies = Array(5).fill(null);
    const killerEnemies = Array(5).fill(null);
    const attackTeam = (attackers, defenders, pending, killer, friendly) => {
      for (let index = 0; index < attackers.length; index++) {
        const attacker = attackers[index];
        if (attacker.hp <= 0) continue;
        const playerAttack = friendly && index === 0;
        const targetIndex = chooseTarget(game, attacker, defenders, strategy, playerAttack);
        if (targetIndex === null) continue;
        const target = defenders[targetIndex];
        let dealt = damageProfile(attacker, target).total * .5 * (.95 + random(game) * .1);
        if (playerAttack) {
          dealt *= proxy.attack;
          if (isBackline(target)) backlineHits++;
          if (isFrontline(target)) frontlineHits++;
          if (strategy === 'backline' && isBackline(target)) dealt *= 1.22;
          if (strategy === 'frontline' && isFrontline(target)) dealt *= 1.14;
          if (strategy === 'heartsteel' && isFrontline(target)) {
            dealt *= 1.06;
            if (game.player.itemIds.includes('3084') && tick % 4 === 0 && heartsteelStacks < 4) heartsteelStacks++;
          }
          if (strategy === 'protect_carry') dealt *= .92;
        }
        if (!friendly && targetIndex === 0) {
          dealt /= proxy.defense;
          if (strategy === 'backline') dealt *= 1.08;
          if (strategy === 'frontline') dealt *= .92;
          playerDamageTaken += dealt;
        }
        if (!friendly && strategy === 'protect_carry' && isBackline(target)) {
          carryDamagePrevented += dealt * .2;
          dealt *= .8;
        }
        pending[targetIndex] += dealt;
        attacker.damage += dealt;
        if (!killer[targetIndex] || dealt > killer[targetIndex].hit) killer[targetIndex] = { index, hit: dealt };
      }
    };
    attackTeam(allies, enemies, pendingEnemies, killerEnemies, true);
    attackTeam(enemies, allies, pendingAllies, killerAllies, false);
    const settle = (defenders, pending, killers, attackers, side) => {
      for (let index = 0; index < defenders.length; index++) {
        const unit = defenders[index];
        if (unit.hp <= 0) continue;
        const before = unit.hp;
        unit.hp -= pending[index];
        if (before > 0 && unit.hp <= 0) {
          const killer = killers[index];
          if (killer) attackers[killer.index].kills++;
          if (events.length < 8) events.push(`${side === 'enemy' ? '我方' : '敌方'}击倒了${unit.champion.name}`);
        }
      }
    };
    settle(enemies, pendingEnemies, killerEnemies, allies, 'enemy');
    settle(allies, pendingAllies, killerAllies, enemies, 'ally');
    // Support healing is abstracted; its effect is bounded and visible in the rules text.
    for (const [team, friendly] of [[allies, true], [enemies, false]]) {
      const living = team.filter(unit => unit.hp > 0);
      if (!living.length) continue;
      const support = living.find(unit => unit.champion.tags.includes('Support'));
      if (!support) continue;
      const patient = living.reduce((a, b) => a.hp / a.maxHp < b.hp / b.maxHp ? a : b);
      const boost = friendly ? proxy.healing : 1;
      patient.hp = Math.min(patient.maxHp, patient.hp + (20 + support.panel.stats.ap * .06) * boost);
    }
    elapsed += .5;
  }
  const allyAlive = allies.filter(unit => unit.hp > 0);
  const enemyAlive = enemies.filter(unit => unit.hp > 0);
  const allyFraction = allies.reduce((sum, unit) => sum + Math.max(0, unit.hp) / unit.maxHp, 0);
  const enemyFraction = enemies.reduce((sum, unit) => sum + Math.max(0, unit.hp) / unit.maxHp, 0);
  const winner = !enemyAlive.length && !allyAlive.length ?
    (allies.reduce((sum, unit) => sum + unit.kills, 0) >= enemies.reduce((sum, unit) => sum + unit.kills, 0) ? 'ally' : 'enemy')
    : !enemyAlive.length ? 'ally' : !allyAlive.length ? 'enemy'
    : allyFraction >= enemyFraction ? 'ally' : 'enemy';
  const strategyEvent = strategy === 'backline'
    ? `你突袭后排 ${backlineHits} 次，切入时承受约 ${Math.round(playerDamageTaken)} 伤害。`
    : strategy === 'frontline'
    ? `你攻击前排 ${frontlineHits} 次，以稳住阵线的打法承受约 ${Math.round(playerDamageTaken)} 伤害。`
    : strategy === 'heartsteel'
    ? `你贴近前排 ${frontlineHits} 次，心之钢有效触发 ${heartsteelStacks} 次。`
    : `你保护己方后排，减少约 ${Math.round(carryDamagePrevented)} 伤害。`;
  events.unshift(strategyEvent);
  return {
    round: game.round, winner, strategy, seconds: elapsed,
    playerDamage: Math.round(allies[0].damage), playerKills: allies[0].kills,
    playerDeaths: allies[0].hp <= 0 ? 1 : 0,
    heartsteelStacks, abstractedAugments: proxy.abstracted,
    backlineHits, frontlineHits, playerDamageTaken: Math.round(playerDamageTaken),
    carryDamagePrevented: Math.round(carryDamagePrevented),
    remaining: { ally: allyAlive.length, enemy: enemyAlive.length, playerHp: Math.max(0, Math.round(allies[0].hp)) },
    events,
    allyKills: allies.reduce((sum, unit) => sum + unit.kills, 0),
    enemyKills: enemies.reduce((sum, unit) => sum + unit.kills, 0),
    allyHp: allies.map(unit => Math.max(0, Math.round(unit.hp))),
    enemyHp: enemies.map(unit => Math.max(0, Math.round(unit.hp))),
    allyUnitKills: allies.map(unit => unit.kills),
    enemyUnitKills: enemies.map(unit => unit.kills),
  };
}

/** Resolve one teamfight and advance to the next augment draft or final result. */
export function playRound(game, strategy, db) {
  if (game.phase !== 'shop') throw new Error('选择海克斯并备战后才能开战');
  if (!STRATEGIES.has(strategy)) throw new Error('未知战斗策略');
  const next = clone(game);
  for (const unit of [...next.allies, ...next.enemies]) {
    botItem(unit, next.round, next.baselineGear || 0, db);
    syncUnit(unit, db, true);
  }
  syncUnit(next.player, db, true);
  const round = simulateRound(next, strategy, db);
  next.lastRound = round;
  next.rounds.push(round);
  next.score[round.winner]++;
  next.player.kills += round.playerKills;
  next.player.deaths += round.playerDeaths;
  next.player.hp = round.remaining.playerHp;
  next.allies.forEach((unit, index) => { unit.hp = round.allyHp[index + 1]; unit.kills += round.allyUnitKills[index + 1]; unit.deaths += round.allyHp[index + 1] <= 0 ? 1 : 0; });
  next.enemies.forEach((unit, index) => { unit.hp = round.enemyHp[index]; unit.kills += round.enemyUnitKills[index]; unit.deaths += round.enemyHp[index] <= 0 ? 1 : 0; });
  const steelPerStack = next.player.augmentIds.includes('quest_steel_your_heart') ? 45 : 30;
  round.heartsteelHealthGained = round.heartsteelStacks * steelPerStack;
  if (round.heartsteelStacks) next.player.growth['3084'] = (next.player.growth['3084'] || 0) + round.heartsteelHealthGained;
  const growthEvents = [];
  if (next.player.augmentIds.includes('phenomenal_evil')) {
    const stacks = clamp(Math.round(round.playerDamage / 450), 2, 12);
    next.player.growth.phenomenal_evil = (next.player.growth.phenomenal_evil || 0) + stacks;
    growthEvents.push(`超凡邪恶按本轮技能交锋抽象增加 ${stacks} 层`);
  }
  if (next.player.augmentIds.includes('infinite_recursion')) {
    const participations = Math.min(5, round.allyKills);
    next.player.growth.infinite_recursion = (next.player.growth.infinite_recursion || 0) + participations;
    growthEvents.push(`无限递归按团队击倒估算增加 ${participations} 次参与击杀`);
  }
  if (next.player.itemIds.includes('126697') && round.playerKills) {
    const bonusAd = round.playerKills * 2;
    next.player.growth['126697'] = (next.player.growth['126697'] || 0) + bonusAd;
    growthEvents.push(`狂妄按个人击倒增加 ${bonusAd} 攻击力`);
  }
  if (next.player.itemIds.includes('6657')) {
    const previous = next.player.growth['6657'] || 0;
    next.player.growth['6657'] = Math.min(10, previous + 3);
    growthEvents.push(`时光之杖推进至 ${next.player.growth['6657']} 层`);
  }
  next.log.push({ kind: 'combat', round: next.round, text: `第 ${next.round} 回合${round.winner === 'ally' ? '我方获胜' : '敌方获胜'}；你造成 ${round.playerDamage} 伤害，击倒 ${round.playerKills} 人。` });
  for (const event of round.events.slice(0, 5)) next.log.push({ kind: 'event', round: next.round, text: event });
  if (round.heartsteelStacks) next.log.push({ kind: 'growth', round: next.round, text: `心之钢触发 ${round.heartsteelStacks} 次，永久增加 ${round.heartsteelHealthGained} 生命值（文字游戏规则）。` });
  for (const event of growthEvents) next.log.push({ kind: 'growth', round: next.round, text: `${event}（文字游戏规则）。` });
  if (next.round >= next.maxRounds) {
    next.phase = 'finished';
    const tieBreak = next.rounds.reduce((sum, entry) => sum + entry.allyKills - entry.enemyKills, 0);
    const winner = next.score.ally > next.score.enemy ? 'ally'
      : next.score.enemy > next.score.ally ? 'enemy'
      : tieBreak >= 0 ? 'ally' : 'enemy';
    next.result = {
      winner, score: { ...next.score },
      reason: next.score.ally === next.score.enemy ? '回合战平，按全场击倒数决胜。' : '按四场团战的获胜回合数决胜。',
      playerKills: next.player.kills, playerDeaths: next.player.deaths,
    };
    next.log.push({ kind: 'result', round: next.round, text: `整场结束：${winner === 'ally' ? '我方获胜' : '敌方获胜'}，团战 ${next.score.ally}:${next.score.enemy}。` });
    return next;
  }
  next.round++;
  next.phase = 'draft';
  next.player.level = MILESTONES[next.round - 1];
  next.player.gold += 2500 + (round.winner === 'ally' ? 700 : 400);
  syncUnit(next.player, db, true);
  for (const unit of [...next.allies, ...next.enemies]) {
    unit.level = MILESTONES[next.round - 1];
    syncUnit(unit, db, true);
  }
  next.rerollsRemaining = 1;
  nextOfferRarity(next);
  drawOffers(next, db);
  next.log.push({ kind: 'system', round: next.round, text: `升至 ${next.player.level} 级，获得新一轮强化选择。` });
  return next;
}

export const TEXT_GAME_STRATEGIES = [
  { id: 'backline', name: '突袭后排', description: '优先追击法师、射手和辅助；切入收益高，也更容易承伤。' },
  { id: 'frontline', name: '先破前排', description: '优先攻击坦克和战士；稳住阵线，减少自身承伤。' },
  { id: 'heartsteel', name: '叠心之钢', description: '贴近前排打持久战；持有心之钢时每次有效触发可为后续回合叠生命值。' },
  { id: 'protect_carry', name: '保护核心', description: '保护我方法师、射手和辅助，牺牲少量自身输出。' },
];
