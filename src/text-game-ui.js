import './text-game.css';
import { createGame, chooseAugment, rerollOffers, buyItem, sellItem, playRound } from './text-game-engine.js';
import { computeBuild } from './model.js';

const STORAGE_KEY = 'mayhem-text-game-v1';
const STRATEGIES = [
  { id:'backline', name:'突进后排', detail:'优先切入脆皮输出位，承担更高被集火风险。' },
  { id:'frontline', name:'稳住前排', detail:'与队友正面接战，优先清理敌方前排。' },
  { id:'heartsteel', name:'叠心之钢', detail:'主动贴近多人换血；装备心之钢时可叠加生命值。' },
  { id:'protect_carry', name:'保护主力', detail:'牵制突进敌人，让己方核心稳定输出。' },
];
const STAGES = [ ['lobby','入局匹配'], ['draft','海克斯'], ['shop','装备与战术'], ['finished','战役结算'] ];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number = value => Math.round(Number(value)||0).toLocaleString('zh-CN');
const safeEffect = offer => {
  const text=String(offer.effect||'').trim();
  if (!text || /@[^@]+@|(?:^|\D)0\s*秒/.test(text)) return '部分数值随对局变化；具体效果请以游戏内说明为准。';
  return text;
};
let context;
let root;
let game;
let ui = { strategy:'backline', search:'', error:'' };

function byId(type,id) { return context.db[type].find(row => String(row.id) === String(id)); }
function persist() {
  try {
    if (game) localStorage.setItem(STORAGE_KEY, JSON.stringify({ patch:context.db.meta?.patch, game }));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* Private browsing may disable storage. The game remains playable. */ }
}
function restore() {
  if (game) return;
  try {
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if (saved?.patch===context.db.meta?.patch && saved?.game?.player && ['draft','shop','finished'].includes(saved.game.phase) && byId('champions',saved.game.player.championId)) game=saved.game;
  } catch { /* Ignore a stale or incomplete save. */ }
}
function currentHero() { return byId('champions', context.state.champion); }
function memberCard(member, kind, isPlayer=false) {
  const champion=byId('champions',member.championId);
  if (!champion) return '';
  const health=Math.max(0,Math.min(100, Math.round(100*(member.hp||0)/(member.maxHp||1))));
  return `<div class="tg-unit ${kind} ${isPlayer?'player':''}" title="${esc(champion.name)} · LV.${number(member.level)} · ${health}% 生命"><img src="${esc(champion.icon)}" alt="" loading="lazy"><strong>${esc(champion.name)}</strong><small>LV.${number(member.level)} · ${health}% HP</small></div>`;
}
function roster() {
  if (!game) return '';
  return `<div class="tg-panel"><div class="tg-roster-label"><b>我方战队</b><small>5 / 5</small></div><div class="tg-roster">${memberCard(game.player,'ally',true)}${game.allies.map(x=>memberCard(x,'ally')).join('')}</div><div class="tg-team-divider"></div><div class="tg-roster-label"><b>敌方战队</b><span class="tg-vs">VS</span><small>5 / 5</small></div><div class="tg-roster">${game.enemies.map(x=>memberCard(x,'enemy')).join('')}</div></div>`;
}
function stats() {
  if (!game) return '';
  const p=game.player, hp=Math.max(0,Math.min(100,(p.hp||0)/(p.maxHp||1)*100));
  return `<div class="tg-panel"><h4>战役状态 <small class="tg-seed">#${esc(game.seed)}</small></h4><div class="tg-stat-line"><span>当前回合</span><b>${number(game.round)} / ${number(game.maxRounds)}</b></div><div class="tg-stat-line"><span>玩家等级</span><b>LV.${number(p.level)}</b></div><div class="tg-stat-line"><span>生命值</span><b>${number(p.hp)} / ${number(p.maxHp)}</b></div><div class="tg-progress"><i style="width:${hp}%"></i></div><div class="tg-stat-line"><span>金币</span><b>${number(p.gold)} G</b></div><div class="tg-stat-line"><span>强化 / 装备</span><b>${p.augmentIds.length} / ${p.itemIds.length}</b></div><div class="tg-stat-line"><span>击杀 / 阵亡</span><b>${number(p.kills)} / ${number(p.deaths)}</b></div><div class="tg-stat-line"><span>心之钢额外生命</span><b>${number(p.growth?.['3084'])}</b></div></div>`;
}
function log() {
  if (!game) return '';
  const entries=[...game.log].reverse().slice(0,20);
  return `<div class="tg-panel"><h4>战斗记录</h4><div class="tg-log" aria-live="polite">${entries.length?entries.map(entry=>`<div class="tg-log-entry ${esc(entry.kind||'')}"><b>R${number(entry.round||1)}</b><span>${esc(entry.text)}</span></div>`).join(''):'<p class="tg-muted">战斗尚未开始。每回合的战术与关键事件会记录在这里。</p>'}</div></div>`;
}
function error() { return ui.error?`<p class="tg-error" role="alert">${esc(ui.error)}</p>`:''; }
function lobby() {
  const hero=currentHero();
  const equipped=context.state.items.map(id=>byId('items',id)).filter(Boolean);
  return `<div class="tg-stage-head"><div><span class="eyebrow">READY ROOM / 5V5 TEXT CAMPAIGN</span><h3>带着你的英雄，打一局完整海斗</h3><p>入局后随机匹配四名队友与五名对手。每轮先从三张海克斯中选一张，再置办装备、选择操作策略。</p></div><span>4 回合 · 4 次强化</span></div><div class="tg-grid"><div class="tg-panel"><h4>本局主角</h4><div class="tg-roster"><div class="tg-unit player"><img src="${esc(hero?.icon)}" alt="" loading="lazy"><strong>${esc(hero?.name)}</strong><small>玩家英雄</small></div></div><div class="tg-team-divider"></div><p class="tg-muted">沿用当前英雄与已配置的 ${equipped.length} 件装备：${equipped.length?equipped.map(x=>esc(x.name)).join('、'):'暂无'}。构筑页手动选择的海克斯不带入文字战役；本局海克斯从零开始，在四轮中逐次三选一。每轮可将整组三张候选刷新一次。其余九名角色会按你带入的装备件数匹配起始配装。</p><div class="tg-actions"><button class="tg-btn" data-tg-action="start">开始匹配　→</button></div></div><div class="tg-panel"><h4>你的决策会改变战局</h4><div class="tg-stat-line"><span>突进后排</span><b>高风险击杀</b></div><div class="tg-stat-line"><span>稳住前排</span><b>稳定交换</b></div><div class="tg-stat-line"><span>叠心之钢</span><b>跨回合成长</b></div><div class="tg-stat-line"><span>保护主力</span><b>团队收益</b></div><p class="tg-muted" style="margin-top:14px">战役是可复现的规则推演。随机发牌、队伍、战术收益和胜负都是本站玩法设定，不代表真实匹配概率或实战胜率。</p></div></div>${error()}`;
}
function draft() {
  const offers=game.offers||[];
  return `<div class="tg-stage-head"><div><span class="eyebrow">ROUND ${number(game.round)} / AUGMENT DRAFT</span><h3>选择本轮海克斯强化</h3><p>三张候选随机出现；本轮可将整组候选刷新一次。已选择的强化会进入本局构筑。</p></div><span>刷新 ${number(game.rerollsRemaining)} / 1</span></div><div class="tg-offers">${offers.map((offer,index)=>`<button class="tg-offer ${esc(offer.rarity||'')}" data-tg-action="augment" data-id="${esc(offer.id)}"><span class="tg-offer-icon" aria-hidden="true">✦${offer.icon?`<img src="${esc(offer.icon)}" alt="" loading="lazy">`:''}</span><span class="tg-offer-copy"><strong>${esc(offer.name)}</strong><small>${esc(({silver:'白银',gold:'黄金',prismatic:'棱彩'})[offer.rarity]||'强化')} · 候选 0${index+1}</small><em>${esc(safeEffect(offer))}</em><span class="tg-offer-chance">选择此强化 ↗</span></span></button>`).join('')}</div><div class="tg-actions"><button class="tg-btn secondary" data-tg-action="reroll" ${game.rerollsRemaining<1?'disabled':''}>↻ 刷新整组候选 ${game.rerollsRemaining<1?'· 已使用':''}</button></div>${error()}`;
}
function equipped() {
  const items=game.player.itemIds.map(id=>byId('items',id)).filter(Boolean);
  const augments=game.player.augmentIds.map(id=>byId('augments',id)).filter(Boolean);
  const panel=computeBuild({champion:byId('champions',game.player.championId),level:game.player.level,augments,items,growth:game.player.growth}).stats;
  return `<div class="tg-panel"><h4>当前构筑 · ${items.length}/6 件</h4><div class="tg-equipped">${items.length?items.map(item=>`<span>${esc(item.name)} <button class="tg-sell" data-tg-action="sell" data-id="${esc(item.id)}" title="出售 ${esc(item.name)}">×</button></span>`).join(''):'<p class="tg-muted">尚未装备。</p>'}</div><h4 style="margin-top:17px">已获强化 · ${augments.length}/4</h4><div class="tg-equipped">${augments.length?augments.map(x=>`<span>${esc(x.name)}</span>`).join(''):'<p class="tg-muted">本局尚未选择强化。</p>'}</div><div class="tg-panel-stats"><span>生命 <b>${number(panel.hp)}</b></span><span>攻击 <b>${number(panel.ad)}</b></span><span>法强 <b>${number(panel.ap)}</b></span><span>护甲 <b>${number(panel.armor)}</b></span></div><p class="tg-muted" style="margin-top:10px">购物后面板即时变化，并用于后续团战推演。</p></div>`;
}
function shopItems() {
  const q=ui.search.trim().toLowerCase();
  const all=context.db.items.filter(item=>item.gold>0 && (!q||[item.name,item.english,item.id].some(value=>String(value||'').toLowerCase().includes(q))));
  const role=byId('champions',game.player.championId)?.tags?.[0];
  const rank=item=>{
    const s=item.stats||{};
    if(role==='Mage'||role==='Support') return (s.FlatMagicDamageMod||0)*3+(item.extras?.haste||0)*2;
    if(role==='Tank') return (s.FlatHPPoolMod||0)/7+(s.FlatArmorMod||0)*2+(s.FlatSpellBlockMod||0)*2;
    return (s.FlatPhysicalDamageMod||0)*3+(s.PercentAttackSpeedMod||0)*100;
  };
  const list=all.sort((a,b)=>rank(b)-rank(a)).slice(0,q?40:24);
  return list.length?list.map(item=>{
    const owned=game.player.itemIds.includes(item.id),full=game.player.itemIds.length>=6,afford=game.player.gold>=item.gold;
    const disabled=owned||full||!afford;
    return `<button class="tg-shop-item" data-tg-action="buy" data-id="${esc(item.id)}" ${disabled?'disabled':''} title="${esc(item.name)} · ${number(item.gold)} 金币${owned?' · 已拥有':full?' · 装备已满':!afford?' · 金币不足':''}"><img src="${esc(item.icon||'')}" alt="" loading="lazy"><span><strong>${esc(item.name)}</strong><small>${number(item.gold)} G${owned?' · 已拥有':''}</small></span></button>`;
  }).join(''):'<p class="tg-muted">没有找到装备，试试其他关键词。</p>';
}
function shop() {
  return `<div class="tg-stage-head"><div><span class="eyebrow">ROUND ${number(game.round)} / WAR ROOM</span><h3>整备装备，制定战术</h3><p>你有 ${number(game.player.gold)} 金币。购买装备立即影响本轮和后续回合；已装备物品可按原价的 70% 出售。</p></div><span>LV.${number(game.player.level)}</span></div><div class="tg-grid"><div><div class="tg-panel"><h4>装备商店 <small style="color:#92b4b8;font-weight:400">· 搜索全部装备</small></h4><input class="tg-shop-search" data-tg-search type="search" placeholder="搜索装备名称…" value="${esc(ui.search)}" aria-label="搜索装备"><div class="tg-shop">${shopItems()}</div></div><div class="tg-panel" style="margin-top:15px"><h4>本轮操作策略</h4><div class="tg-strategies">${STRATEGIES.map(strategy=>`<button class="tg-option ${ui.strategy===strategy.id?'selected':''}" data-tg-action="strategy" data-id="${strategy.id}" aria-pressed="${ui.strategy===strategy.id}"><strong>${esc(strategy.name)}</strong><span>${esc(strategy.detail)}</span></button>`).join('')}</div><div class="tg-actions"><button class="tg-btn" data-tg-action="fight">执行战术 · 进入团战　→</button></div>${error()}</div></div><div>${equipped()}${game.lastRound?`<div class="tg-panel" style="margin-top:15px"><h4>上一轮简报</h4><p class="tg-muted">${game.lastRound.winner==='ally'?'我方占优':game.lastRound.winner==='enemy'?'敌方占优':'双方胶着'} · 你造成 ${number(game.lastRound.playerDamage)} 伤害 · 击杀 ${number(game.lastRound.playerKills)} · 本轮心之钢成长 ${number(game.lastRound.heartsteelHealthGained)}</p></div>`:''}</div></div>`;
}
function lastRoundNote() {
  const r=game?.lastRound;
  if (!r) return '';
  const strategy=STRATEGIES.find(x=>x.id===r.strategy)?.name||'默认行动';
  return `<div class="tg-round-report ${r.winner==='ally'?'victory':'defeat'}"><div class="tg-report-head"><div><small>ROUND ${number(r.round)} / AFTER ACTION</small><h4>${r.winner==='ally'?'本轮团战胜利':'本轮团战失利'}</h4></div><b>${esc(strategy)}</b></div><div class="tg-report-metrics"><span>个人伤害 <b>${number(r.playerDamage)}</b></span><span>个人击杀 <b>${number(r.playerKills)}</b></span><span>存活人数 <b>${number(r.remaining?.ally)} : ${number(r.remaining?.enemy)}</b></span>${r.heartsteelHealthGained>0?`<span>永久生命 <b>+${number(r.heartsteelHealthGained)}</b></span>`:''}</div>${r.events?.length?`<div class="tg-report-events">${r.events.slice(0,3).map(event=>`<p>✦ ${esc(event)}</p>`).join('')}</div>`:''}${r.abstractedAugments>0?`<p class="tg-report-foot">${number(r.abstractedAugments)} 个未量化海克斯采用小幅规则代理加成。</p>`:''}</div>`;
}
function finished() {
  const result=game.result||{}, win=result.winner==='ally';
  return `<div class="tg-result ${win?'victory':'defeat'}"><small>CAMPAIGN COMPLETE / 5V5</small><h3>${win?'战役胜利':'战役落败'}</h3><p>${esc(result.reason||'四轮交锋已结束。')} ${win?'你的构筑与操作策略帮助队伍拿下对局。':'调整强化、装备与战术，再打一局。'}</p><div class="tg-result-metrics"><span>我方积分 <b>${number(result.score?.ally)}</b></span><span>敌方积分 <b>${number(result.score?.enemy)}</b></span><span>个人击杀 <b>${number(game.player.kills)}</b></span><span>心之钢成长 <b>${number(game.player.growth?.['3084'])}</b></span></div></div><div class="tg-panel"><h4>四轮战役记录</h4><div class="tg-round-list">${game.rounds.map(round=>`<div><b>0${number(round.round)}</b><span>${round.winner==='ally'?'我方胜利':'敌方胜利'}</span><small>${esc(STRATEGIES.find(x=>x.id===round.strategy)?.name||'团队作战')}</small><em>${number(round.playerDamage)} 伤害</em></div>`).join('')}</div></div><div class="tg-actions"><button class="tg-btn" data-tg-action="restart">重新匹配一局　↻</button></div>${lastRoundNote()}${error()}`;
}
function stageBody() {
  if (!game) return lobby();
  if (game.phase==='shop') return `${shop()}${lastRoundNote()}<div class="tg-grid" style="margin-top:16px"><div>${roster()}</div><div>${stats()}${log()}</div></div>`;
  const main=game.phase==='draft'?draft():game.phase==='shop'?shop():finished();
  return `<div class="tg-grid"><div>${main}${game.phase==='draft'?lastRoundNote():''}</div><div>${stats()}</div></div><div class="tg-grid" style="margin-top:16px"><div>${roster()}</div><div>${log()}</div></div>`;
}
function render() {
  if (!root) return;
  const phase=game?.phase||'lobby';
  root.innerHTML=`<div class="tg-top"><div><span class="eyebrow">05 / INTERACTIVE MAYHEM</span><h2>海斗 · 文字战役</h2><p>从入局匹配到最后一波团战，你的海克斯抉择、装备路线和临场操作共同书写战报。</p></div><div class="tg-top-tools"><span class="tg-top-badge">✦ RULE-BASED 5V5</span>${game?'<button class="tg-new-game" data-tg-action="abandon">新开一局 ↻</button>':''}</div></div><div class="tg-steps">${STAGES.map(([id,label],index)=>`<div class="tg-step ${phase===id?'active':STAGES.findIndex(x=>x[0]===phase)>index?'done':''}"><b>0${index+1}</b>${label}</div>`).join('')}</div><div class="tg-body">${stageBody()}</div><div class="tg-disclaimer">海克斯开局及 7/11/15 级选择节点参考官方。每轮整组三张刷新一次、发牌权重、金币、装备商店节奏及战斗模拟为本站文字游戏规则；没有真实发牌概率、匹配算法或实测对局胜率。</div>`;
}
function update(action) {
  try { game=action();ui.error='';persist();render(); }
  catch (err) { ui.error=err?.message||'操作未完成，请重试。';render(); }
}
function onClick(event) {
  const button=event.target.closest('[data-tg-action]');
  if (!button || !root.contains(button)) return;
  const action=button.dataset.tgAction, id=button.dataset.id;
  if (action==='abandon') { game=null;ui={strategy:'backline',search:'',error:''};persist();render();return; }
  if (action==='strategy') { ui.strategy=id;render();return; }
  if (action==='start'||action==='restart') { ui.search='';ui.strategy='backline'; update(()=>createGame({championId:context.state.champion,db:context.db,seed:Math.floor(Math.random()*0x7fffffff)+1,initialItemIds:context.state.items.filter(Boolean)}));return; }
  if (!game) return;
  if (action==='augment') update(()=>chooseAugment(game,id,context.db));
  else if (action==='reroll') update(()=>rerollOffers(game,context.db));
  else if (action==='buy') update(()=>buyItem(game,id,context.db));
  else if (action==='sell') update(()=>sellItem(game,id,context.db));
  else if (action==='fight') { update(()=>playRound(game,ui.strategy,context.db));root.scrollIntoView({behavior:'smooth',block:'start'}); }
}
function onInput(event) {
  if (!event.target.matches('[data-tg-search]')) return;
  ui.search=event.target.value;
  const list=root.querySelector('.tg-shop');
  if (list) list.innerHTML=shopItems();
}
export function mountTextGame(input) {
  context=input;
  restore();
  root=document.createElement('section');
  root.id='text-game';root.className='text-game';
  const anchor=document.querySelector('#battle-lab')||document.querySelector('.presets');
  anchor?.before(root);
  root.addEventListener('click',onClick);
  root.addEventListener('input',onInput);
  root.addEventListener('error',event=>{
    if(event.target.matches?.('.tg-offer-icon img')) event.target.remove();
  },true);
  render();
}
