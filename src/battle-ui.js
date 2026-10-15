import { fmt, clamp } from './model.js';
import { createUnderfedBots, makeCombatant, simulateDuel, simulateOneVsFive } from './battle-engine.js';

const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DEFAULT_BOTS = ['Lux', 'Ashe', 'Teemo', 'Sona', 'Garen'];
const LABELS = { duel:'1 对 1 构筑对决', pve:'1 对 5 人机挑战' };
let current = { mode:'duel', opponentChampion:'Lux', imported:null, pasted:'', bots:[...DEFAULT_BOTS], result:null, resultMode:null, playerKey:null, error:'', notice:'' };
let context;
let root;

function get(type, id) { return context.db[type].find(row => row.id === id); }
function image(champion, className = '') { return `<img class="${className}" src="${html(champion.icon)}" alt="${html(champion.name)}" loading="lazy">`; }
function selectedPlayer() {
  const { state } = context;
  return makeCombatant({
    champion:get('champions',state.champion), level:state.level,
    augments:state.augments.map(id=>get('augments',id)).filter(Boolean),
    items:state.items.map(id=>get('items',id)).filter(Boolean), growth:state.growth,
  });
}
function quickOpponent() {
  const champion = get('champions', current.opponentChampion) || get('champions','Lux');
  const role = champion.tags[0];
  const ids = role==='Tank' ? ['3084','3065','3083']
    : role==='Marksman' ? ['3031','3046','3153']
    : role==='Mage' ? ['3089','6655','3135']
    : role==='Assassin' ? ['3142','6692','3074']
    : role==='Support' ? ['2065','6617','3089']
    : ['3078','3071','3053'];
  const augmentIds = role==='Tank' ? ['goliath','celestial_body']
    : role==='Mage' ? ['recursion','witchful_thinking']
    : role==='Marksman' ? ['deft','jeweled_gauntlet']
    : role==='Support' ? ['recursion','celestial_body']
    : ['blunt_force','deft'];
  return makeCombatant({ champion, level:context.state.level, items:ids.map(id=>get('items',id)).filter(Boolean), augments:augmentIds.map(id=>get('augments',id)).filter(Boolean) });
}
function opponent() {
  if (!current.imported) return quickOpponent();
  const b = current.imported;
  return makeCombatant({
    champion:get('champions',b.champion), level:b.level,
    augments:b.augments.map(id=>get('augments',id)).filter(Boolean),
    items:b.items.map(id=>get('items',id)).filter(Boolean), growth:b.growth,
  });
}
function parseFriendLink(input) {
  let link;
  try { link = new URL(input.trim()); } catch { throw new Error('请输入完整的本站构筑链接'); }
  if (link.hostname !== location.hostname || !link.pathname.startsWith(location.pathname)) {
    throw new Error('请粘贴海斗论战本站的构筑链接');
  }
  const q = link.searchParams;
  const champion = q.get('c');
  if (!get('champions',champion)) throw new Error('链接中没有可识别的英雄');
  const augments = (q.get('a')||'').split(',').slice(0,4).filter(id=>get('augments',id));
  const items = (q.get('i')||'').split(',').slice(0,6).filter(id=>get('items',id));
  const growth = {};
  for (const entry of (q.get('g')||'').split(',')) {
    const [key,value] = entry.split(':');
    if (key && Number.isFinite(Number(value))) growth[key] = clamp(Number(value),0,100000);
  }
  return { champion, level:clamp(Number(q.get('l'))||18,1,18), augments, items, growth };
}
function buildText(build) {
  return `${build.items.length} 件装备 · ${build.augments.length} 个强化 · LV.${build.level}`;
}
function portrait(build, side) {
  return `<div class="fighter ${side}">${image(build.champion)}<div><span>${side==='player'?'你的构筑':'对手构筑'}</span><strong>${html(build.champion.name)}</strong><small>${buildText(build)}</small></div></div>`;
}
function duelControls() {
  const player = selectedPlayer();
  const enemy = opponent();
  const options = [...context.db.champions].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  return `<div class="battle-matchup">${portrait(player,'player')}<div class="battle-vs">VS</div>${portrait(enemy,'enemy')}</div>
    <div class="opponent-setup"><div class="setup-title"><strong>设置对手</strong><span>可选择示例英雄，或导入另一位玩家分享的完整构筑。</span></div>
    <div class="opponent-actions"><label>示例英雄<select id="opponent-hero" ${current.imported?'disabled':''}>${options.map(champ=>`<option value="${html(champ.id)}" ${champ.id===current.opponentChampion?'selected':''}>${html(champ.name)}</option>`).join('')}</select></label><div class="friend-link"><input id="friend-link" type="url" placeholder="粘贴好友的构筑链接..." value="${html(current.pasted)}"><button id="import-friend">导入构筑</button></div><button id="copy-my-build" class="battle-quiet">复制我的构筑链接</button>${current.imported?'<button id="clear-friend" class="battle-quiet">恢复示例</button>':''}</div>
    <p class="setup-note">${current.imported?`当前对手：好友分享的 ${html(enemy.champion.name)} 构筑。`:'示例对手自动配备 3 件装备与 2 个强化；导入好友链接可按对方的实际选择比拼。'}</p></div>
    <button class="battle-start" id="start-duel">✦ 开始 1 对 1 推演 <span>→</span></button>`;
}
function pveControls() {
  const player = selectedPlayer();
  const options = [...context.db.champions].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  const bots = createUnderfedBots(current.bots.map(id=>get('champions',id)),player.level,context.db.items);
  return `<div class="pve-brief"><div>${image(player.champion)}<span><small>挑战者</small><strong>${html(player.champion.name)}</strong><em>LV.${player.level} · ${player.items.length} 件装备 · ${player.augments.length} 强化</em></span></div><b>1 <small>VS</small> 5</b><p>五名人机各落后你 4 级，仅有 1 件成装、没有海克斯。你可以选择不同英雄组成敌方队伍。</p></div>
    <div class="bot-header"><strong>选择五名人机</strong><span>不可重复 · 默认贫弱发育</span></div><div class="bots">
    ${current.bots.map((id,index)=>{const champ=get('champions',id)||get('champions',DEFAULT_BOTS[index]);const botItem=bots[index].items[0];return `<label class="bot-card"><span class="bot-number">0${index+1}</span>${image(champ)}<select data-bot="${index}" aria-label="人机 ${index+1}">${options.map(x=>`<option value="${html(x.id)}" ${x.id===champ.id?'selected':current.bots.includes(x.id)?'disabled':''}>${html(x.name)}</option>`).join('')}</select><small title="${html(botItem?.name||'无装备')}">LV.${bots[index].level} · ${html(botItem?.name||'无装备')}</small></label>`}).join('')}</div>
    <button class="battle-start" id="start-pve">✦ 开始 1 对 5 推演 <span>→</span></button>`;
}
function notesCard(result, mode) {
  const coverage = mode==='duel' ? `${Math.round(result.modelCoverage[0]*100)}% / ${Math.round(result.modelCoverage[1]*100)}%` : `${Math.round(result.modelCoverage*100)}%`;
  return `<div class="battle-caveat"><b>推演口径</b><span>海克斯面板覆盖：${coverage}</span><p>依据双方等级、可量化属性、护甲/魔抗、穿透与小幅机制修正。技能释放时机、控制链、召唤师技能、海斗专属平衡和未建模海克斯可能改变实战。结果不是胜率。</p></div>`;
}
function resultDuel(result) {
  const player = selectedPlayer(), enemy = opponent();
  const verdict = result.winner==='draw'?'势均力敌':result.winner==='left'?'你的构筑胜出':'对手构筑胜出';
  const reasons = [...result.leftDamage.counter.reasons.map(text=>`${player.champion.name}：${text}`),...result.rightDamage.counter.reasons.map(text=>`${enemy.champion.name}：${text}`)];
  return `<div class="battle-result ${result.winner==='left'?'victory':result.winner==='right'?'defeat':'draw'}"><div class="battle-result-head"><span>SIMULATION RESULT / 1V1</span><strong>${verdict}</strong><small>预计交战 ${fmt(result.seconds,1)} 秒</small></div><div class="duel-stats"><div><b>${html(player.champion.name)}</b><span>有效输出 ${fmt(result.leftDamage.total)} / 秒</span><span>剩余生命 ${fmt(result.leftRemaining)}</span><i style="--fill:${Math.max(0,result.leftRemaining/player.panel.stats.hp*100)}%"></i></div><div><b>${html(enemy.champion.name)}</b><span>有效输出 ${fmt(result.rightDamage.total)} / 秒</span><span>剩余生命 ${fmt(result.rightRemaining)}</span><i style="--fill:${Math.max(0,result.rightRemaining/enemy.panel.stats.hp*100)}%"></i></div></div><div class="battle-reasons"><b>克制与机制依据</b><p>${reasons.length?reasons.map(html).join(' · '):'没有触发额外克制规则；结果主要来自双方可量化面板。'}</p></div>${notesCard(result,'duel')}</div>`;
}
function resultPve(result) {
  const player = selectedPlayer();
  const verdict = result.winner==='player'?'一人击败五名人机':result.winner==='bots'?'五人机守住战线':'战斗超时 · 未分胜负';
  const tone = result.winner==='player'?'victory':result.winner==='bots'?'defeat':'draw';
  return `<div class="battle-result ${tone}"><div class="battle-result-head"><span>SIMULATION RESULT / 1V5</span><strong>${verdict}</strong><small>推演时长 ${fmt(result.seconds,1)} 秒</small></div><div class="pve-numbers"><div><span>击败人机</span><b>${result.defeated}<small> / 5</small></b></div><div><span>造成伤害</span><b>${fmt(result.totalDealt)}</b></div><div><span>承受伤害</span><b>${fmt(result.totalTaken)}</b></div><div><span>剩余生命</span><b>${fmt(result.playerRemaining)}</b></div></div><div class="pve-bot-list">${current.bots.map((id,i)=>{const champ=get('champions',id);return `<div>${image(champ)}<span>${html(champ.name)}</span><b class="${result.botRemaining[i]===0?'down':''}">${result.botRemaining[i]===0?'已击败':`${fmt(result.botRemaining[i])} HP`}</b></div>`}).join('')}</div><p class="battle-narrative">${result.firstKill!==null?`首次击败人机约在 ${fmt(result.firstKill,1)} 秒。`:'没有击败任何人机。'} ${html(player.champion.name)}的范围伤害按 ${Math.round(result.splash*100)}% 溅射估算；人机协同效率按 ${Math.round(result.teamEfficiency*100)}% 计算，敌方控制将你的输出系数压至 ${Math.round(result.crowdControlFactor*100)}%。</p>${notesCard(result,'pve')}</div>`;
}
function render() {
  if (!root) return;
  const mode = current.mode;
  root.innerHTML = `<div class="battle-top"><div><span class="eyebrow">05 / BATTLE SIMULATOR</span><h2>虚拟对战试炼</h2><p>用当前构筑进入对决。每次推演完全可复现，克制加成会列出触发原因。</p></div><div class="battle-emblem">✦</div></div><div class="battle-tabs">${Object.entries(LABELS).map(([key,label])=>`<button data-mode="${key}" class="${mode===key?'active':''}">${label}</button>`).join('')}</div><div class="battle-body">${mode==='duel'?duelControls():pveControls()}${current.error?`<p class="battle-error" role="alert">${html(current.error)}</p>`:''}${current.notice?`<p class="battle-notice" role="status">${html(current.notice)}</p>`:''}${current.result&&current.resultMode===mode?(mode==='duel'?resultDuel(current.result):resultPve(current.result)):''}</div><div class="battle-footer">RULE-BASED SIMULATION <span>非实战胜率预测</span></div>`;
  bind();
}
function bind() {
  root.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { current.mode=button.dataset.mode;current.error='';current.notice='';render(); }));
  root.querySelector('#opponent-hero')?.addEventListener('change', event => { current.opponentChampion=event.target.value;current.imported=null;current.result=null;current.notice='';render(); });
  root.querySelector('#friend-link')?.addEventListener('input', event => { current.pasted=event.target.value; });
  root.querySelector('#copy-my-build')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(location.href);current.notice='构筑链接已复制，可以发给朋友。';current.error=''; } catch { current.error='复制失败，请从地址栏复制构筑链接。';current.notice=''; } render(); });
  root.querySelector('#import-friend')?.addEventListener('click', () => { try { current.imported=parseFriendLink(current.pasted);current.error='';current.notice='';current.result=null;render(); } catch(error) { current.error=error.message;current.notice='';render(); } });
  root.querySelector('#clear-friend')?.addEventListener('click', () => { current.imported=null;current.pasted='';current.result=null;current.notice='';render(); });
  root.querySelector('#start-duel')?.addEventListener('click', () => { current.result=simulateDuel(selectedPlayer(),opponent());current.resultMode='duel';current.error='';render();root.querySelector('.battle-result')?.scrollIntoView({behavior:'smooth',block:'nearest'}); });
  root.querySelectorAll('[data-bot]').forEach(select => select.addEventListener('change', event => { current.bots[Number(event.target.dataset.bot)]=event.target.value;current.result=null;current.error='';render(); }));
  root.querySelector('#start-pve')?.addEventListener('click', () => { try { const bots=createUnderfedBots(current.bots.map(id=>get('champions',id)),context.state.level,context.db.items);current.result=simulateOneVsFive(selectedPlayer(),bots);current.resultMode='pve';current.error='';render();root.querySelector('.battle-result')?.scrollIntoView({behavior:'smooth',block:'nearest'}); } catch(error) { current.error=error.message;render(); } });
}

export function mountBattle(input) {
  context=input;
  const key=JSON.stringify(input.state);
  if (current.playerKey!==key) { current.result=null;current.playerKey=key; }
  root=document.createElement('section');root.id='battle-lab';root.className='battle-lab';
  const anchor=document.querySelector('.presets');
  anchor.before(root);
  render();
}
