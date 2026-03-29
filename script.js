// ─── Constants ────────────────────────────────────────────
const EMOJIS = ['😊','🦠','🐺','🐑','🌱','🔥','💀','👻','🤖','⭐','💎','🧲','☢️','🧪','🍎','🐝','🦋','🌊','❄️','🎯','🐭','🐸','🦊','🌸','💧','🌙'];
const SWATCHES = ['#c0392b','#2563a8','#1a7a4a','#b85c00','#6b3fa0','#b8860b','#1a6a7a','#7a1a4a','#3a5a20','#5a3a20'];

// ─── State ────────────────────────────────────────────────
let agentTypes = [];
let agents = [];
let rules = [];
let selectedType = 0;
let running = false;
let tick = 0;
let animId = null;
let pickedEmoji = EMOJIS[0];
let popHistory = {};
const HIST_LEN = 180;

// ─── Canvas ───────────────────────────────────────────────
const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');
const chartEl = document.getElementById('chartEl');
const chartCtx = chartEl.getContext('2d');

function resize() {
  const w = canvas.parentElement;
  canvas.width = w.clientWidth;
  canvas.height = w.clientHeight;
  chartEl.width = chartEl.offsetWidth * devicePixelRatio;
  chartEl.height = chartEl.offsetHeight * devicePixelRatio;
  chartCtx.scale(devicePixelRatio, devicePixelRatio);
}
window.addEventListener('resize', resize);
setTimeout(resize, 50);

canvas.addEventListener('click', e => {
  if (!agentTypes.length) return;
  const r = canvas.getBoundingClientRect();
  spawnOne(agentTypes[selectedType], e.clientX - r.left, e.clientY - r.top);
  refreshLeft();
  if (!running) draw();
});

// ─── Agent factory ────────────────────────────────────────
function spawnOne(type, x, y) {
  const ang = Math.random() * Math.PI * 2;
  const spd = 0.5 + Math.random() * 1.2;
  agents.push({ type: type.name, emoji: type.emoji, x, y, vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd, age: 0 });
}

function doSpawn() {
  if (!agentTypes.length) return;
  const type = agentTypes[selectedType];
  const n = +document.getElementById('spawnN').value;
  for (let i = 0; i < n; i++) {
    spawnOne(type, 50 + Math.random() * (canvas.width - 100), 50 + Math.random() * (canvas.height - 100));
  }
  refreshLeft();
  if (!running) draw();
}

function clearAll() { agents = []; popHistory = {}; tick = 0; refreshLeft(); updateHud(); if (!running) { draw(); drawChart(); } }

function hardReset() {
  clearAll(); agents = []; agentTypes = []; rules = []; selectedType = 0;
  running = false; cancelAnimationFrame(animId);
  document.getElementById('playBtn').textContent = '▶ Play';
  setHud(false);
  refreshLeft(); refreshRuleBuilder(); renderRules(); ctx.clearRect(0,0,canvas.width,canvas.height); chartCtx.clearRect(0,0,chartEl.width,chartEl.height); updateHud();
}

// ─── Physics ──────────────────────────────────────────────
function step() {
  const spd = +document.getElementById('simSpd').value / 5;
  const wand = +document.getElementById('wanderR').value / 10;
  const toKill = new Set();
  const toAdd = [];

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    a.age++;

    for (const rule of rules) {
      if (rule.verb === 'infection') {
        if (a.type !== rule.typeA) continue;
        for (let j = 0; j < agents.length; j++) {
          if (i === j) continue;
          const b = agents[j];
          if (b.type !== rule.typeB) continue;
          const d2 = (b.x-a.x)**2 + (b.y-a.y)**2;
          if (d2 < rule.radius**2 && Math.random() < rule.prob) {
            const t = agentTypes.find(t => t.name === rule.typeA);
            b.type = rule.typeA; if (t) b.emoji = t.emoji; b.age = 0;
          }
        }
      }
      if (rule.verb === 'attraction') {
        if (a.type !== rule.typeA) continue;
        for (let j = 0; j < agents.length; j++) {
          if (i===j) continue; const b = agents[j];
          if (b.type !== rule.typeB) continue;
          const dx = b.x-a.x, dy = b.y-a.y;
          const d = Math.sqrt(dx*dx+dy*dy);
          if (d > 5 && d < rule.range) { a.vx += dx/d*rule.strength; a.vy += dy/d*rule.strength; }
        }
      }
      if (rule.verb === 'repulsion') {
        if (a.type !== rule.typeA) continue;
        for (let j = 0; j < agents.length; j++) {
          if (i===j) continue; const b = agents[j];
          if (b.type !== rule.typeB) continue;
          const dx = b.x-a.x, dy = b.y-a.y;
          const d = Math.sqrt(dx*dx+dy*dy);
          if (d > 5 && d < rule.range) { a.vx -= dx/d*rule.strength; a.vy -= dy/d*rule.strength; }
        }
      }
      if (rule.verb === 'transition') {
        if (a.type !== rule.typeA) continue;
        if (a.age >= rule.afterTicks) {
          const t = agentTypes.find(t => t.name === rule.typeB);
          a.type = rule.typeB; if (t) a.emoji = t.emoji; a.age = 0;
        }
      }
      if (rule.verb === 'death_time') {
        if (a.type !== rule.typeA) continue;
        if (a.age >= rule.afterTicks && Math.random() < 0.015) toKill.add(i);
      }
      if (rule.verb === 'death_contact') {
        if (a.type !== rule.typeA) continue;
        for (let j = 0; j < agents.length; j++) {
          if (i===j) continue; const b = agents[j];
          if (b.type !== rule.typeB) continue;
          const d2 = (b.x-a.x)**2+(b.y-a.y)**2;
          if (d2 < rule.radius**2 && Math.random() < rule.prob) { toKill.add(i); break; }
        }
      }
      if (rule.verb === 'kill_spawn') {
        if (a.type !== rule.typeA) continue;
        for (let j = 0; j < agents.length; j++) {
          if (i===j) continue; const b = agents[j];
          if (b.type !== rule.typeB) continue;
          const d2 = (b.x-a.x)**2+(b.y-a.y)**2;
          if (d2 < rule.radius**2 && Math.random() < rule.prob) {
             toKill.add(j);
             const t = agentTypes.find(t => t.name === rule.typeC);
             if (t && agents.length < 500) {
               toAdd.push({ type: t, x: b.x, y: b.y });
             }
          }
        }
      }
      if (rule.verb === 'reproduction') {
        if (a.type !== rule.typeA) continue;
        if (Math.random() < rule.rate && agents.length < 500) {
          const t = agentTypes.find(t => t.name === rule.typeA);
          if (t) toAdd.push({ type: t, x: a.x+(Math.random()-.5)*25, y: a.y+(Math.random()-.5)*25 });
        }
      }
    }

    // Move
    a.vx += (Math.random()-.5)*wand;
    a.vy += (Math.random()-.5)*wand;
    a.vx *= 0.93; a.vy *= 0.93;
    const s = Math.sqrt(a.vx*a.vx+a.vy*a.vy);
    if (s > 2.5) { a.vx=a.vx/s*2.5; a.vy=a.vy/s*2.5; }
    a.x += a.vx * spd; a.y += a.vy * spd;
    if (a.x < 18) { a.x=18; a.vx=Math.abs(a.vx); }
    if (a.x > canvas.width-18) { a.x=canvas.width-18; a.vx=-Math.abs(a.vx); }
    if (a.y < 18) { a.y=18; a.vy=Math.abs(a.vy); }
    if (a.y > canvas.height-18) { a.y=canvas.height-18; a.vy=-Math.abs(a.vy); }
  }

  agents = agents.filter((_,i) => !toKill.has(i));
  for (const {type,x,y} of toAdd) spawnOne(type,x,y);
  tick++;
}

// ─── Rendering ────────────────────────────────────────────
function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.font = '16px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const a of agents) {
    const t = agentTypes.find(t => t.name === a.type);
    if (t) {
      // Soft halo
      const g = ctx.createRadialGradient(a.x,a.y,2,a.x,a.y,13);
      g.addColorStop(0, t.color + '28');
      g.addColorStop(1, t.color + '00');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(a.x,a.y,13,0,Math.PI*2); ctx.fill();
    }
    ctx.fillText(a.emoji, a.x, a.y);
  }
}

function drawChart() {
  const w = chartEl.offsetWidth, h = chartEl.offsetHeight;
  chartCtx.clearRect(0,0,w,h);
  const types = Object.keys(popHistory);
  if (!types.length) return;
  const maxV = Math.max(...Object.values(popHistory).flat(), 1);
  for (const name of types) {
    const hist = popHistory[name];
    if (hist.length < 2) continue;
    const t = agentTypes.find(t => t.name === name);
    chartCtx.beginPath();
    chartCtx.strokeStyle = t ? t.color : '#888';
    chartCtx.lineWidth = 1.5;
    for (let i = 0; i < hist.length; i++) {
      const x = (i/(HIST_LEN-1))*w;
      const y = h - (hist[i]/maxV)*h;
      i===0 ? chartCtx.moveTo(x,y) : chartCtx.lineTo(x,y);
    }
    chartCtx.stroke();
  }
}

function recordPop() {
  for (const t of agentTypes) {
    if (!popHistory[t.name]) popHistory[t.name] = [];
    popHistory[t.name].push(agents.filter(a => a.type === t.name).length);
    if (popHistory[t.name].length > HIST_LEN) popHistory[t.name].shift();
  }
}

// ─── Loop ─────────────────────────────────────────────────
function loop() {
  if (!running) return;
  const steps = Math.max(1, Math.floor(+document.getElementById('simSpd').value/2));
  for (let i=0;i<steps;i++) step();
  recordPop();
  draw();
  drawChart();
  updateHud();
  animId = requestAnimationFrame(loop);
}

function togglePlay() {
  running = !running;
  document.getElementById('playBtn').textContent = running ? '⏸ Pause' : '▶ Play';
  setHud(running);
  if (running) animId = requestAnimationFrame(loop);
  else cancelAnimationFrame(animId);
}

function setHud(on) {
  document.getElementById('runHud').textContent = on ? 'RUNNING' : 'PAUSED';
  document.getElementById('hStatus').textContent = on ? 'running' : 'paused';
}

function updateHud() {
  document.getElementById('tickHud').textContent = `TICK ${tick}`;
  document.getElementById('hTick').textContent = `tick ${tick}`;
  document.getElementById('hAgents').textContent = `${agents.length} agents`;
}

// ─── Left panel ───────────────────────────────────────────
function refreshLeft() {
  // Agent cards
  const el = document.getElementById('agentCards');
  if (!agentTypes.length) {
    el.innerHTML = '<div style="font-size:0.62rem;color:var(--muted);text-align:center;padding:8px 0">No types yet</div>';
  } else {
    el.innerHTML = agentTypes.map((t,i) => `
      <div class="agent-card ${i===selectedType?'selected':''}" onclick="selectType(${i})">
        <span class="agent-em">${t.emoji}</span>
        <div class="agent-meta">
          <div class="agent-name-text">${t.name}</div>
          <div class="agent-ct">${agents.filter(a=>a.type===t.name).length} alive</div>
        </div>
        <div class="agent-swatch" style="background:${t.color}"></div>
        <button class="agent-del" onclick="event.stopPropagation();deleteType(${i})">✕</button>
      </div>
    `).join('');
  }

  // Pop table
  const pt = document.getElementById('popTable');
  if (!agents.length) { pt.innerHTML = '<div style="font-size:0.62rem;color:var(--muted)">No agents</div>'; return; }
  const counts = {};
  for (const a of agents) counts[a.type] = (counts[a.type]||0)+1;
  const max = Math.max(...Object.values(counts));
  pt.innerHTML = Object.entries(counts).map(([k,v]) => {
    const t = agentTypes.find(t=>t.name===k);
    return `<div class="pop-row">
      <span style="font-size:0.7rem">${t?t.emoji:'?'}</span>
      <div class="pop-bar-wrap"><div class="pop-bar" style="width:${(v/max*100).toFixed(1)}%;background:${t?t.color:'#888'}"></div></div>
      <span>${v}</span>
    </div>`;
  }).join('');
}

function selectType(i) { selectedType = i; refreshLeft(); }

function deleteType(i) {
  const name = agentTypes[i].name;
  agents = agents.filter(a => a.type !== name);
  agentTypes.splice(i, 1);
  if (selectedType >= agentTypes.length) selectedType = Math.max(0, agentTypes.length-1);
  rules = rules.filter(r => r.typeA !== name && r.typeB !== name);
  delete popHistory[name];
  refreshLeft();
  refreshRuleBuilder();
  renderRules();
  if (!running) { draw(); drawChart(); }
}

// ─── Modal ────────────────────────────────────────────────
function openModal() {
  pickedEmoji = EMOJIS[0];
  const inputEl = document.getElementById('newName');
  inputEl.value = '';
  inputEl.classList.remove('error');
  document.getElementById('emojiGrid').innerHTML = EMOJIS.map(e =>
    `<span class="emoji-opt ${e===pickedEmoji?'sel':''}" onclick="pickE('${e}',this)">${e}</span>`
  ).join('');
  document.getElementById('agentModal').classList.add('open');
  setTimeout(() => inputEl.focus(), 50);
}
function closeModal() { document.getElementById('agentModal').classList.remove('open'); }
function pickE(e, el) {
  pickedEmoji = e;
  document.querySelectorAll('.emoji-opt').forEach(x => x.classList.remove('sel'));
  el.classList.add('sel');
}
function confirmAgent() {
  const inputEl = document.getElementById('newName');
  const name = inputEl.value.trim();
  if (!name) {
    inputEl.classList.add('error');
    inputEl.animate([
      { transform: 'translateX(0)' },
      { transform: 'translateX(-4px)' },
      { transform: 'translateX(4px)' },
      { transform: 'translateX(-4px)' },
      { transform: 'translateX(4px)' },
      { transform: 'translateX(0)' }
    ], { duration: 300 });
    return;
  }
  if (agentTypes.find(t => t.name===name)) { alert('Name already used'); return; }
  agentTypes.push({ name, emoji: pickedEmoji, color: SWATCHES[agentTypes.length % SWATCHES.length] });
  selectedType = agentTypes.length - 1;
  closeModal();
  refreshLeft();
  refreshRuleBuilder();
}

document.getElementById('newName').addEventListener('input', e => e.target.classList.remove('error'));
document.getElementById('newName').addEventListener('keydown', e => { if (e.key === 'Enter') confirmAgent(); });

// ─── Rule Builder ─────────────────────────────────────────
const VERB_INFO = {
  infection:    { hasB: true,  params: ['radius:Radius:10:60:22','prob:Probability:1:100:5:0.01:%'] },
  attraction:   { hasB: true,  params: ['range:Range:20:300:150','strength:Strength:1:20:8:0.01'] },
  repulsion:    { hasB: true,  params: ['range:Range:20:300:120','strength:Strength:1:20:10:0.01'] },
  transition:   { hasB: true,  params: ['afterTicks:After (ticks):20:1000:300'] },
  death_time:   { hasB: false, params: ['afterTicks:After (ticks):20:2000:400'] },
  death_contact:{ hasB: true, hasC: false, params: ['radius:Radius:10:60:22','prob:Probability:1:100:4:0.01:%'] },
  kill_spawn:   { hasB: true, hasC: true,  params: ['radius:Radius:10:60:22','prob:Probability:1:100:4:0.01:%'] },
  reproduction: { hasB: false, hasC: false, params: ['rate:Rate (×0.001):1:20:3:0.001'] },
};

const VERB_LABELS = {
  infection:'infects', attraction:'attracts', repulsion:'repels',
  transition:'transitions to', death_time:'dies after time',
  death_contact:'is killed by', kill_spawn:'kills and spawns', reproduction:'reproduces'
};

function refreshRuleBuilder() {
  const names = agentTypes.map(t => t.name);
  const opts = names.map(n => `<option value="${n}">${agentTypes.find(t=>t.name===n).emoji} ${n}</option>`).join('');
  document.getElementById('rb_typeA').innerHTML = opts || '<option>—</option>';
  document.getElementById('rb_typeB').innerHTML = opts || '<option>—</option>';
  document.getElementById('rb_typeC').innerHTML = opts || '<option>—</option>';
  rbVerbChanged();
}

function rbVerbChanged() {
  const verb = document.getElementById('rb_verb').value;
  const info = VERB_INFO[verb];
  const typeBSel = document.getElementById('rb_typeB');
  const typeCSel = document.getElementById('rb_typeC');
  typeBSel.style.display = info.hasB ? '' : 'none';
  typeCSel.style.display = info.hasC ? '' : 'none';

  // Build param sliders
  const pg = document.getElementById('rb_params');
  pg.innerHTML = info.params.map(p => {
    const [id, lbl, min, max, def, scaleStr, unitStr] = p.split(':');
    const scale = parseFloat(scaleStr) || 1;
    const unit = unitStr ? unitStr.replace(/"/g, '') : '';
    const initialDisp = parseFloat((def * scale).toFixed(3)) + unit;
    return `<div class="param-row">
      <span class="param-lbl">${lbl}</span>
      <input type="range" min="${min}" max="${max}" value="${def}" data-id="${id}" data-scale="${scale}" data-unit="${unit}"
        oninput="this.nextElementSibling.textContent=parseFloat((this.value*this.dataset.scale).toFixed(3))+this.dataset.unit;updatePreview()">
      <span class="param-val">${initialDisp}</span>
    </div>`;
  }).join('');
  updatePreview();
}

function getParams() {
  const params = {};
  document.querySelectorAll('#rb_params input[type=range]').forEach(inp => {
    const scale = parseFloat(inp.dataset.scale) || 1;
    params[inp.dataset.id] = parseFloat(inp.value) * scale;
  });
  return params;
}

function updatePreview() {
  if (!agentTypes.length) { document.getElementById('rb_preview').textContent = 'Add agent types first.'; return; }
  const verb = document.getElementById('rb_verb').value;
  const a = document.getElementById('rb_typeA').value;
  const b = document.getElementById('rb_typeB').value;
  const c = document.getElementById('rb_typeC').value;
  const p = getParams();
  const emA = agentTypes.find(t=>t.name===a)?.emoji || '';
  const emB = agentTypes.find(t=>t.name===b)?.emoji || '';
  const emC = agentTypes.find(t=>t.name===c)?.emoji || '';

  const sentences = {
    infection: `${emA} ${a} spreads to ${emB} ${b} within radius ${p.radius?.toFixed(0)}, chance ${(p.prob*100).toFixed(0)}%`,
    attraction: `${emA} ${a} moves toward ${emB} ${b} within range ${p.range?.toFixed(0)}`,
    repulsion: `${emA} ${a} flees from ${emB} ${b} within range ${p.range?.toFixed(0)}`,
    transition: `${emA} ${a} becomes ${emB} ${b} after ${p.afterTicks?.toFixed(0)} ticks`,
    death_time: `${emA} ${a} dies after ~${p.afterTicks?.toFixed(0)} ticks`,
    death_contact: `${emA} ${a} is killed by ${emB} ${b} on contact`,
    kill_spawn: `${emA} ${a} kills ${emB} ${b} and spawns ${emC} ${c} on contact`,
    reproduction: `${emA} ${a} spontaneously reproduces (rate ≈${(p.rate*1000).toFixed(1)}‰/tick)`,
  };
  document.getElementById('rb_preview').textContent = sentences[verb] || '—';
}

function commitRule() {
  if (!agentTypes.length) { alert('Add agent types first.'); return; }
  const verb = document.getElementById('rb_verb').value;
  const typeA = document.getElementById('rb_typeA').value;
  const typeB = document.getElementById('rb_typeB').value;
  const typeC = document.getElementById('rb_typeC').value;
  const p = getParams();
  const preview = document.getElementById('rb_preview').textContent;
  rules.push({ verb, typeA, typeB, typeC, ...p, _preview: preview });
  renderRules();
}

function renderRules() {
  const el = document.getElementById('rulesScroll');
  if (!rules.length) { el.innerHTML = '<div class="rules-empty">No rules yet.<br>Build one above.</div>'; return; }

  const verbColor = { infection:'infection', attraction:'attraction', repulsion:'repulsion',
    transition:'transition', death_time:'death', death_contact:'death', kill_spawn:'death', reproduction:'reproduction' };

  el.innerHTML = rules.map((r,i) => `
    <div class="rule-card">
      <span class="rc-type ${verbColor[r.verb]}">${r.verb.replace('_',' ')}</span>
      <div class="rc-desc">${r._preview}</div>
      <button class="rc-del" onclick="deleteRule(${i})">✕</button>
    </div>
  `).join('');
}

function deleteRule(i) { rules.splice(i,1); renderRules(); }

// ─── Init ─────────────────────────────────────────────────
agentTypes.push({ name: 'Healthy', emoji: EMOJIS[0], color: SWATCHES[0] });
selectedType = 0;

refreshLeft();
refreshRuleBuilder();
draw();

// Done
