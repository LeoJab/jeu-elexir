/* Élixir — interface : écrans, cartes, assistants de choix, fenêtres de réaction. */
(function () {
  'use strict';
  const D = window.DATA, E = window.Engine;
  const App = window.App = { S: null, me: null, players: [], room: '', isHost: false, act() {}, emote() {}, startGame() {}, leave() {}, ended: false };
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hue = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const seat = () => App.S && App.S.players.find(p => p.id === App.me.id);
  const byId = id => App.S.players.find(p => p.id === id);
  const spellOf = sid => D.spells[sid];
  let sel = null;               // sélection courante : { t: 'spell'|'find', id }
  let promptKey = '';           // identifiant de la fenêtre de réaction ouverte
  let modalCancel = null, modalTimer = 0;
  const LV = { 1: 'Niveau 1', 2: 'Niveau 2', 3: 'Niveau 3', 4: 'Niveau 4' };

  /* ---------- Petits outils ---------- */
  function toast(msg, kind) {
    const d = document.createElement('div'); d.className = 'toast ' + (kind || ''); d.textContent = msg; $('#toasts').appendChild(d); setTimeout(() => d.remove(), 3700);
  }
  function show(id) { $$('.screen').forEach(s => s.classList.toggle('hidden', s.id !== id)); }
  function avatar(p) { return `<span class="av" data-chadgang-id="${esc(p.id)}" style="--h:${hue(p.id)}">${esc((p.name || '?').trim().charAt(0).toUpperCase())}</span>`; }
  function openModal(html, onForce) {
    closeModal(true); const m = $('#modal'); m.innerHTML = html; m.classList.remove('hidden'); modalCancel = onForce || null; return m;
  }
  function closeModal(silent) {
    const m = $('#modal'); clearInterval(modalTimer); const cb = modalCancel; modalCancel = null; m.classList.add('hidden'); m.innerHTML = ''; m.onclick = null;
    if (!silent && cb) cb();
  }
  const groupIng = hand => { const g = {}; hand.filter(E.isIng).forEach(c => { const k = E.ingOf(c); (g[k] = g[k] || []).push(c); }); return g; };

  /* ---------- Cartes ---------- */
  const typeOf = c => { const i = E.cardInfo(c); return i.kind === 'ing' ? 'ing' : i.kind === 'tr' ? 'tr' : i.useless ? 'junk' : 'obj'; };
  const TYPE_LBL = { ing: 'Ingrédient', obj: 'Objet', junk: 'Objet inutile', tr: 'Transaction' };
  const TYPE_ORD = { ing: 0, obj: 1, junk: 2, tr: 3 };
  /* Coin en haut à droite : jaune = ingrédient, bleu = objet utile, rouge = objet inutile, violet = transaction, orange = sortilège (niveau). */
  function findCard(c, o) {
    o = o || {}; const i = E.cardInfo(c), ty = typeOf(c);
    return `<div class="card ${i.kind}${i.useless ? ' junk' : ''}${o.sel ? ' sel' : ''}${o.mini ? ' mini' : ''}" data-cid="${c}" style="--c:${i.color || '#fff'}${o.z != null && !o.sel ? ';z-index:' + o.z : ''}"><i class="corner ${ty}" title="${TYPE_LBL[ty]}"></i><div class="em">${i.emoji}</div><div class="nm">${esc(i.name)}</div>${o.n > 1 ? `<b class="cnt">×${o.n}</b>` : ''}</div>`;
  }
  /* Grandes cartes (aperçu et animations) : nom, coin de type, image, effet. */
  function fullCard(c, compact) {
    const i = E.cardInfo(c), ty = typeOf(c);
    return `<div class="fcard ${ty}${compact ? ' compact' : ''}"><i class="corner ${ty}"></i><div class="fn">${esc(i.name)}</div><div class="fi">${i.emoji}</div>${compact || i.kind === 'ing' ? '' : `<div class="fe">${esc(i.effect)}</div>`}</div>`;
  }
  function fullSpell(sid, compact) {
    const sp = spellOf(sid);
    return `<div class="fcard sp lv${sp.level}${compact ? ' compact' : ''}"><i class="corner sp">${sp.level}</i><div class="fn">${esc(sp.name)}</div><div class="fi">${sp.emoji}</div><div class="fing">${sp.ing.map(g => `<span title="${esc(D.ingredients[g].name)}">${D.ingredients[g].emoji}</span>`).join('')}</div>${compact ? '' : `<div class="fe">${esc(sp.effect)}</div>`}</div>`;
  }
  function fullTr(t) {
    const tr = D.transactions[t];
    return `<div class="fcard tr"><i class="corner tr"></i><div class="fn">${esc(tr.name)}</div><div class="fi">${tr.emoji}</div><div class="fe">${esc(tr.effect)}</div></div>`;
  }
  function chips(sp, hand) {
    const have = {}; (hand || []).forEach(c => { if (E.isIng(c)) { const k = E.ingOf(c); have[k] = (have[k] || 0) + 1; } });
    return sp.ing.map(g => { const ok = hand ? have[g] > 0 : true; if (ok && hand) have[g]--; return `<span class="${ok ? '' : 'miss'}" title="${esc(D.ingredients[g].name)}">${D.ingredients[g].emoji}</span>`; }).join('');
  }
  function spellCard(sid, o) {
    o = o || {}; const sp = spellOf(sid);
    return `<div class="spell lv${sp.level}${o.can ? ' can' : ''}${o.sel ? ' sel' : ''}${o.dim ? ' dim' : ''}" data-sid="${sid}"><i class="corner sp">${sp.level}</i><div class="top"><span>${'★'.repeat(sp.level)}</span><span>${o.tag || ''}</span></div><div class="em">${sp.emoji}</div><div class="nm">${esc(sp.name)}</div><div class="ings">${chips(sp, o.hand)}</div></div>`;
  }

  /* =====================================================================
     Assistants de choix (promesses)
     ===================================================================== */
  function pick(o) {
    return new Promise(res => {
      if (!o.items.length) { toast(o.empty || 'Rien à choisir.', 'err'); return res(null); }
      const min = o.min == null ? 1 : o.min, max = o.max == null ? 1 : o.max, auto = min === 1 && max === 1, chosen = [];
      const html = `<div class="panel pick"><h3>${o.title}</h3>${o.sub ? `<p class="psub">${o.sub}</p>` : ''}<div class="grid">${o.items.map((it, i) => `<button class="it${it.disabled ? ' dis' : ''}${it.cls ? ' ' + it.cls : ''}" data-i="${i}">${it.html}${it.note ? `<small>${it.note}</small>` : ''}<i class="no"></i></button>`).join('')}</div><div class="foot">${o.cancel === false ? '' : '<button class="btn ghost" data-x>Annuler</button>'}${auto ? '' : '<button class="btn" data-ok>Valider</button>'}</div></div>`;
      const m = openModal(html, () => res(null));
      const okb = $('[data-ok]', m), refresh = () => {
        $$('.it', m).forEach(b => { const k = chosen.indexOf(+b.dataset.i); b.classList.toggle('on', k >= 0); $('.no', b).textContent = o.ordered ? k + 1 : '✓'; });
        if (okb) okb.disabled = !(chosen.length >= min && chosen.length <= max);
      };
      refresh();
      m.onclick = e => {
        if (e.target.closest('[data-x]')) { closeModal(true); return res(null); }
        if (e.target.closest('[data-ok]')) { closeModal(true); Sfx.play('click'); return res(chosen.map(i => o.items[i].id)); }
        const b = e.target.closest('.it'); if (!b) return;
        const i = +b.dataset.i; Sfx.play('click');
        if (auto) { closeModal(true); return res([o.items[i].id]); }
        const k = chosen.indexOf(i); if (k >= 0) chosen.splice(k, 1); else if (chosen.length < max) chosen.push(i); else if (max === 1) { chosen.length = 0; chosen.push(i); }
        refresh();
      };
    });
  }
  const playerItems = (ctx, filter) => (App.S.players.filter(p => p.id !== App.me.id && (!filter || filter(p))).map(p => {
    const t = E.canTarget(App.S, seat(), p, ctx.meta, ctx.level);
    return { id: p.id, html: `${avatar(p)}<span>${esc(p.name)}</span>`, cls: 'pplayer', disabled: !t.ok, note: t.why || `🃏${p.hand.length} 📜${p.spells.length}` };
  }));
  const findItems = list => list.map(c => ({ id: c, html: findCard(c) }));

  async function collectNeeds(needs, ctx) {
    const S = App.S, me = seat(), prm = {};
    for (const n of needs) {
      const [t, a] = n.split(':');
      switch (t) {
        case 'player': { const r = await pick({ title: 'Choisis ta victime 😈', items: playerItems(ctx), empty: 'Personne ne peut être visé !' }); if (!r) return null; prm.player = r[0]; break; }
        case 'ing': { const r = await pick({ title: 'Quel ingrédient ?', items: D.ingredients.map(g => ({ id: g.id, html: `<div class="mini" style="--c:${g.color}"><span>${g.emoji}</span><b>${esc(g.name)}</b></div>` })) }); if (!r) return null; prm.ing = r[0]; break; }
        case 'cards': {
          const [mi, ma] = a.includes('-') ? a.split('-').map(Number) : [+a, +a];
          const hand = me.hand.filter(c => c !== ctx.selfCid), mn = Math.min(mi, hand.length), mx = Math.min(ma, hand.length);
          if (!hand.length && mi > 0) { toast("Tu n'as pas de trouvaille à donner.", 'err'); return null; }
          if (mx === 0) { prm.cards = []; break; }
          const r = await pick({ title: mn === mx ? `Choisis ${mn} trouvaille${mn > 1 ? 's' : ''}` : `Choisis de ${mn} à ${mx} trouvailles`, items: findItems(hand), min: mn, max: mx }); if (!r) return null; prm.cards = r; break;
        }
        case 'castOf': {
          const items = []; S.players.forEach(p => { if (p.id === me.id) return; const t = E.canTarget(S, me, p, ctx.meta, ctx.level); p.cast.forEach(sid => items.push({ id: p.id + '|' + sid, html: `<b>${esc(p.name)}</b>${spellCard(sid)}`, disabled: !t.ok, note: t.why })); });
          const r = await pick({ title: 'Quel sortilège lancé faire reprendre ?', items, empty: "Personne n'a encore lancé de sortilège." }); if (!r) return null;
          const [pid, sid] = r[0].split('|'); prm.player = pid; prm.sid = +sid; break;
        }
        case 'gage': {
          const items = S.gages.filter(g => g.on === me.id && g.mode !== 'once' && (!ctx.lv1 || spellOf(g.sid).level === 1)).map(g => ({ id: g.i, html: spellCard(g.sid) }));
          const r = await pick({ title: 'Quel gage ?', items, empty: 'Aucun gage ne te concerne.' }); if (!r) return null; prm.gi = r[0]; break;
        }
        case 'spell': case 'spell12': {
          const items = me.spells.filter(s => s !== ctx.self && (t === 'spell' || spellOf(s).level <= 2) && (!ctx.needPile || S.piles[spellOf(s).level].length)).map(s => ({ id: s, html: spellCard(s) }));
          const r = await pick({ title: 'Quel sortilège de ta main ?', items, empty: "Tu n'as pas de sortilège éligible." }); if (!r) return null; prm.mine = r[0]; break;
        }
        case 'sub': case 'sub1': case 'dup': {
          let ids;
          if (t === 'dup') ids = [S.lastSpell];
          else ids = me.spells.filter(s => s !== ctx.self && spellOf(s).key !== 'miroir' && !E.META[spellOf(s).key].need.some(x => ['sub', 'dup'].includes(x)) && (t !== 'sub1' || spellOf(s).level === 1)
            && (ctx.key !== 'coupmaitre' || E.canSubAfter(S, me, spellOf(ctx.self), spellOf(s), 1)));
          let sid;
          if (t === 'dup') sid = ids[0];
          else { const r = await pick({ title: t === 'sub1' ? 'Quel sortilège de niveau 1 lancer gratuitement ?' : ctx.key === 'coupmaitre' ? 'Quel sortilège lancer avec un ingrédient de moins ?' : 'Quel sortilège lancer gratuitement ?', items: ids.map(s => ({ id: s, html: spellCard(s, { hand: me.hand }) })), empty: 'Aucun sortilège lançable.' }); if (!r) return null; sid = r[0]; }
          const sp2 = spellOf(sid), sub = await collectNeeds(E.META[sp2.key].need, { self: sid, meta: E.META[sp2.key], level: sp2.level, key: sp2.key }); if (!sub) return null; prm.sub = { sid, p: sub }; break;
        }
        case 'myIng': { const r = await pick({ title: 'Quel ingrédient donner ?', items: findItems(me.hand.filter(c => E.isIng(c))) }); if (!r) return null; prm.mine = r[0]; break; }
        case 'discIng': { const r = await pick({ title: 'Quel ingrédient prendre dans la défausse ?', items: findItems(S.discard.filter(E.isIng)), empty: 'Pas d\'ingrédient dans la défausse.' }); if (!r) return null; prm.disc = r; break; }
        case 'disc': { const k = Math.min(+a, S.discard.length); const r = await pick({ title: `Prends ${k} carte${k > 1 ? 's' : ''} dans la défausse`, items: findItems(S.discard.slice().reverse()), min: k, max: k, empty: 'La défausse est vide.' }); if (!r) return null; prm.disc = r; break; }
        case 'order': { const top = S.deck.slice(0, 5); const r = await pick({ title: '🔮 Haut de la pioche', sub: 'Touche dans l\'ordre où tu veux piocher (1 = la prochaine).', items: findItems(top), min: top.length, max: top.length, ordered: true, empty: 'La pioche est vide.' }); if (!r) return null; prm.order = r; break; }
      }
    }
    return prm;
  }

  /* ---------- Lancer / jouer ---------- */
  function myTurn() { const S = App.S; return S && S.phase === 'play' && S.players[S.turn].id === App.me.id && !S.pend; }
  async function doCast(sid) {
    if (!myTurn()) return toast(App.S.pend ? 'Une action est en cours…' : "Ce n'est pas ton tour.", 'err');
    const sp = spellOf(sid), me = seat(), c = E.canCast(App.S, me, sp); if (!c.ok) return toast(c.why, 'err');
    const meta = E.META[sp.key], prm = await collectNeeds(meta.need, { self: sid, meta, level: sp.level, key: sp.key }); if (!prm) return;
    sel = null; App.act({ t: 'cast', sid, p: prm });
  }
  async function doPlay(cid) {
    if (!myTurn()) return toast(App.S.pend ? 'Une action est en cours…' : "Ce n'est pas ton tour.", 'err');
    const i = E.cardInfo(cid); let prm = {};
    if (i.kind === 'obj') {
      if (E.NOPLAY.has(i.key)) return toast(i.key === 'baguette' ? "S'utilise toute seule quand il manque un ingrédient." : i.key === 'cape' ? 'Se joue en réaction, quand un sort te vise.' : 'Se joue pendant les ventes aux enchères.', 'err');
      const meta = E.OMETA[i.key] || { need: [] };
      prm = await collectNeeds(meta.need, { selfCid: cid, meta, lv1: i.key === 'bouclier' }); if (!prm) return;
    }
    sel = null; App.act({ t: 'play', cid, p: prm });
  }

  /* =====================================================================
     Fenêtres de réaction (quand l'état demande une réponse de ma part)
     ===================================================================== */
  function syncPrompt() {
    const S = App.S, me = seat(), pd = S && S.pend; let key = '';
    if (pd && me && S.phase === 'play') {
      if (pd.k === 'react' && pd.on === me.id) key = 'r' + pd.id;
      else if (pd.k === 'multi' && pd.wait.includes(me.id)) key = 'm' + pd.id;
      else if (pd.k === 'take' && pd.who === me.id) key = 't' + pd.id;
      else if (pd.k === 'pickplayer' && pd.who === me.id) key = 'p' + pd.id;
    }
    if (key === promptKey) return;
    if (promptKey) { closeModal(true); }
    promptKey = key; if (!key) return;
    Sfx.play('alert');
    if (pd.k === 'react') showReact(pd); else if (pd.k === 'multi') showMulti(pd); else if (pd.k === 'take') showTake(pd); else showPickPlayer(pd);
  }
  function showReact(pd) {
    const S = App.S, me = seat(), by = byId(pd.by), sp = spellOf(pd.sid), hasCape = me.hand.includes(E.CAPE);
    const mirror = me.spells.includes(E.MIRROR.id) && !me.silence && E.payFor(S, me, E.MIRROR);
    const m = openModal(`<div class="panel"><h3>⚠️ ${esc(by.name)} te lance « ${esc(sp.name)} » !</h3><div class="psub">${sp.emoji} ${esc(sp.effect)}</div>
      <div class="react-actions"><button class="btn red" data-a="take">😬 Subir</button>
      <button class="btn ${me.hand.length ? '' : 'off'}" data-a="buy">💸 Me racheter (donner ${Math.min(2, me.hand.length)} trouvaille${me.hand.length > 1 ? 's' : ''} à ${esc(by.name)})</button>
      ${hasCape ? `<button class="btn green" data-a="cape">🧿 Creuset de Mikaël : annuler le sort</button>` : ''}
      ${mirror ? `<button class="btn green" data-a="mirror">🪞 Lancer « ${esc(E.MIRROR.name)} » : renvoyer le sort</button>` : ''}</div>
      <div class="countbar"><i style="width:100%"></i></div></div>`, null);
    const bar = $('.countbar i', m), start = Date.now(), total = Math.max(1000, pd.dl - Date.now());
    modalTimer = setInterval(() => { bar.style.width = Math.max(0, 100 - (Date.now() - start) / total * 100) + '%'; }, 250);
    m.onclick = async e => {
      const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a; Sfx.play('click');
      if (a === 'buy') {
        const k = Math.min(2, me.hand.length); if (!k) return;
        clearInterval(modalTimer); const r = await pick({ title: `Donne ${k} trouvaille${k > 1 ? 's' : ''} à ${esc(by.name)}`, items: findItems(me.hand), min: k, max: k, cancel: false });
        if (r) { promptKey = 'done'; App.act({ t: 'ans', a: 'buy', cards: r }); } return;
      }
      promptKey = 'done'; closeModal(true); App.act({ t: 'ans', a });
    };
  }
  async function showMulti(pd) {
    const me = seat(), S = App.S; let r = null, a = { t: 'ans' };
    const to = pd.to ? byId(pd.to) : null;
    switch (pd.what) {
      case 'pass': r = await pick({ title: '🎠 Tournesort', sub: 'Choisis un sortilège à passer à ton voisin de gauche.', items: me.spells.map(s => ({ id: s, html: spellCard(s) })), cancel: false }); if (r) a.sid = r[0]; break;
      case 'give': { const n = Math.min(pd.n, me.hand.length); r = await pick({ title: `🎁 Donne ${n} trouvaille${n > 1 ? 's' : ''} à ${esc(to ? to.name : '')}`, items: findItems(me.hand), min: n, max: n, cancel: false }); if (r) a.cards = r; break; }
      case 'discard': r = await pick({ title: '❄️ Grêle !', sub: 'Défausse une trouvaille.', items: findItems(me.hand), cancel: false }); if (r) a.cards = r; break;
    }
    if (r && App.S.pend && App.S.pend.id === pd.id) { promptKey = 'done'; App.act(a); }
  }
  async function showTake(pd) {
    const me = seat(), f = byId(pd.from), cards = f.hand.slice();
    const r = await pick({ title: `👀 La main de ${esc(f.name)}`, sub: `Prends ${pd.n} carte${pd.n > 1 ? 's' : ''}${pd.ing ? ' (un ingrédient)' : ''}${pd.give ? ', en échange d\'une des tiennes' : ''}.`, items: cards.map(c => ({ id: c, html: findCard(c), disabled: pd.ing && !E.isIng(c) })), min: Math.min(pd.n, cards.filter(c => !pd.ing || E.isIng(c)).length), max: pd.n, cancel: false, empty: 'Sa main est vide.' });
    const a = { t: 'ans', cards: r || [] }; if (!r && !cards.length) { App.act(a); return; } if (!r) return;
    if (pd.give && r.length && me.hand.length) { const g = await pick({ title: 'Que donnes-tu en échange ?', items: findItems(me.hand), cancel: false }); if (!g) return; a.mine = g; }
    promptKey = 'done'; App.act(a);
  }
  async function showPickPlayer(pd) {
    const r = await pick({ title: '💼 Racket', sub: 'Prends une trouvaille au hasard à…', items: playerItems({}), cancel: false });
    if (r) { promptKey = 'done'; App.act({ t: 'ans', pl: r[0] }); }
  }

  /* =====================================================================
     Écrans
     ===================================================================== */
  function renderLobby() {
    const L = $('#lobby'), host = App.isHost, link = location.origin + location.pathname + '?room=' + App.room;
    L.innerHTML = `<div class="logo" style="margin:2vh 0 6px"><span class="flask" style="font-size:44px">🧪</span></div>
      <div class="panel-box"><h2>Salle <span class="code">${esc(App.room)}</span></h2>
      <div class="psub" style="font-weight:700;font-size:13px;opacity:.8">Invite tes amis avec le bouton « Inviter » du hub, ou donne-leur le code.</div>
      <div class="plist">${App.players.map((p, i) => `<div class="pl ${i === 0 ? 'host' : ''}">${avatar(p)}<span>${esc(p.name)}${p.id === App.me.id ? ' (toi)' : ''}</span></div>`).join('')}</div>
      ${host ? `<div class="setup-row"><label style="flex:1">Longueur de la partie<select id="s-len"><option value="7">Courte (7 ingrédients)</option><option value="9" selected>Normale (9 ingrédients)</option><option value="13">Longue (13 ingrédients)</option></select></label></div>
        <button id="b-start" class="btn big" style="width:100%" ${App.players.length < 2 ? 'disabled' : ''}>🎲 Lancer la partie (${App.players.length} joueur${App.players.length > 1 ? 's' : ''})</button>
        ${App.players.length < 2 ? '<p class="psub" style="text-align:center">Il faut au moins 2 joueurs (3 à 8, c\'est le mieux !).</p>' : ''}`
        : '<p style="text-align:center;font-weight:900">⏳ En attente que l\'hôte lance la partie…</p>'}
      <div style="display:flex;gap:8px;margin-top:10px"><button id="b-rules1" class="btn ghost" style="flex:1">❓ Règles</button><button id="b-cat1" class="btn ghost" style="flex:1">📖 Cartes</button><button id="b-leave" class="btn ghost">🚪</button></div></div>`;
    const b = $('#b-start', L); if (b) b.onclick = () => App.startGame(+$('#s-len', L).value);
    $('#b-rules1', L).onclick = showRules; $('#b-cat1', L).onclick = () => showCatalog(); $('#b-leave', L).onclick = () => App.leave();
  }

  function renderSetup() {
    const S = App.S, me = seat(), P = $('#setup');
    if (!me) { P.innerHTML = '<div class="panel-box"><h2>👀 Spectateur</h2><p>Une partie est en cours de préparation. Tu pourras jouer à la prochaine !</p></div>'; return; }
    const sum = E.spellSum(me), ready = E.ready(S, me), left = S.target - sum;
    P.innerHTML = `<div class="panel-box"><h2>🧙 Compose ta main de sortilèges</h2>
      <p class="psub" style="font-size:13px">Pioche des sortilèges jusqu'à totaliser exactement <b>${S.target} ingrédients</b>. Peu de gros sorts (durs à lancer mais puissants) ou plein de petits ?</p>
      <div class="progress"><i style="width:${Math.min(100, sum / S.target * 100)}%"></i></div><p style="text-align:center;margin:4px 0">${sum} / ${S.target} ${ready ? '✅ prêt !' : ''}</p>
      <div class="piles">${[1, 2, 3, 4].map(l => `<button class="pilebtn" style="--c:${['', '#86efac', '#7dd3fc', '#d8b4fe', '#fcd34d'][l]}" data-l="${l}" ${l > left || !S.piles[l].length || ready ? 'disabled' : ''}><b>${'★'.repeat(l)}</b>Niveau ${l}<small>${l} ingrédient${l > 1 ? 's' : ''} · ${S.piles[l].length} restants</small></button>`).join('')}</div>
      <div class="spells" style="background:rgba(0,0,0,.08);border-radius:10px;min-height:60px">${me.spells.map(s => spellCard(s)).join('') || '<small style="opacity:.6;padding:6px">Aucun sortilège pour l\'instant</small>'}</div>
      <div style="display:flex;gap:8px;margin-top:8px"><button id="b-auto" class="btn" style="flex:1" ${ready ? 'disabled' : ''}>🎲 Compléter au hasard</button><button id="b-rules2" class="btn ghost">❓</button><button id="b-cat2" class="btn ghost">📖</button></div>
      <div class="readyline">${S.players.map(p => `<span class="${E.ready(S, p) ? 'ok' : ''}">${esc(p.name)} ${E.ready(S, p) ? '✅' : '…'}</span>`).join('')}</div></div>`;
    $$('.pilebtn', P).forEach(b => b.onclick = () => { Sfx.play('draw'); App.act({ t: 'pickSpell', level: +b.dataset.l }); });
    $('#b-auto', P).onclick = () => { Sfx.play('draw'); App.act({ t: 'autoSpells' }); };
    $('#b-rules2', P).onclick = showRules; $('#b-cat2', P).onclick = () => showCatalog();
    $$('.spell', P).forEach(el => el.onclick = () => showSpellInfo(+el.dataset.sid));
  }

  /* ---------- Table ---------- */
  function flagsOf(p) {
    const S = App.S, f = [];
    if (p.lock) f.push('🔒'); if (p.shield) f.push('🛡️'); if (p.untarget) f.push('📵'); if (p.wall) f.push('🧱'); if (p.silence) f.push('🔇'); if (p.skip) f.push('⏭️'); if (p.double) f.push('2️⃣'); if (p.off) f.push('📴');
    if (S.racket.includes(p.id)) f.push('💼'); if (S.taxe === p.id) f.push('💸'); if (S.lum && S.lum.by === p.id) f.push('💡'); if (S.timer && S.timer.pid === p.id) f.push('⏳');
    return f.join(' ');
  }
  /* Un boulet par sort subi (gages visant le joueur, saut de tour, silence, sablier). */
  function victims(p) {
    const S = App.S, v = [];
    S.gages.forEach(g => { if (g.on === p.id || (g.on === '*' && g.by !== p.id)) v.push(spellOf(g.sid).emoji); });
    if (p.skip) v.push('⏭️'); if (p.silence) v.push('🔇'); if (p.timed) v.push('⏳');
    return v;
  }
  const fmtT = ms => { const l = Math.max(0, Math.round(ms / 1000)); return Math.floor(l / 60) + ':' + String(l % 60).padStart(2, '0'); };
  function seatPos(i, n, zoom) {
    const a = Math.PI / 2 + i * 2 * Math.PI / n, mob = innerWidth < 900, rx = zoom ? (mob ? 38 : 44) : (mob ? 33 : 37), ry = zoom ? 40 : (mob ? 36 : 38);
    return { x: 50 + rx * Math.cos(a), y: 50 + ry * Math.sin(a) };
  }
  function seatHTML(p, i, n, zoom) {
    const S = App.S, me = seat(), cur = S.players[S.turn] === p && S.phase === 'play', v = victims(p), isMe = me && me.id === p.id;
    const pos = seatPos(i, n, zoom), dir = pos.x > 55 ? -1 : 1, tilt = dir * (v.length >= 3 ? 24 : v.length === 2 ? 15 : v.length === 1 ? 7 : 0), fl = flagsOf(p);
    const hand = S.reveal ? `<div class="ohand">${p.hand.map(c => E.cardInfo(c).emoji).join('')}</div>` : '';
    const cast = p.cast.length ? `<div class="ocast">${p.cast.map(sid => `<span class="cb lv${spellOf(sid).level}" data-sid="${sid}">${spellOf(sid).emoji}</span>`).join('')}</div>` : '';
    return `<div class="seat${cur ? ' turn' : ''}${p.off ? ' off' : ''}${isMe ? ' me' : ''}${dir < 0 ? ' bl' : ''}" data-pid="${esc(p.id)}" style="left:${pos.x.toFixed(1)}%;top:${pos.y.toFixed(1)}%"><div class="sbox" style="--tilt:${tilt}deg">
      <div class="sh">${avatar(p)}<div class="sn">${esc(p.name)}${isMe ? ' ★' : ''}</div></div>
      <div class="ss"><span title="Trouvailles">🃏${p.hand.length}</span><span title="Sortilèges restants">📜${p.spells.length}</span><span title="Points (ingrédients) restants">⭐${E.spellSum(p)}</span></div>
      ${fl ? `<div class="sf">${fl}</div>` : ''}${hand}${cast}
      <div class="balls">${v.map((e, k) => `<span class="ball" style="--k:${k}"><em>${e}</em></span>`).join('')}</div></div></div>`;
  }
  function pendText(pd) {
    const n = id => { const p = byId(id); return p ? p.name : '?'; };
    switch (pd.k) {
      case 'react': return `⏳ ${n(pd.on)} doit réagir à « ${spellOf(pd.sid).name} »…`;
      case 'multi': return `⏳ En attente de : ${pd.wait.map(n).join(', ')}`;
      case 'take': return `👀 ${n(pd.who)} fouille la main de ${n(pd.from)}…`;
      case 'pickplayer': return `💼 ${n(pd.who)} choisit qui racketter…`;
      case 'story': return `📖 ${n(pd.on)} raconte une histoire sans s'arrêter !`;
    }
    return '';
  }
  function sortsHTML() {
    const S = App.S, me = seat(), t = Date.now();
    if (!S.gages.length) return '<div class="empty">Aucun sort en cours.</div>';
    return S.gages.map(g => {
      const sp = spellOf(g.sid), tgt = g.on === '*' ? null : byId(g.on), by = byId(g.by), mineC = me && g.by === me.id, onMe = me && (g.on === me.id || g.on === '*' && g.by !== me.id);
      const who = g.on === '*' ? `Tous obéissent à <b>${esc(by.name)}</b>` : `<b>${esc(tgt ? tgt.name : '?')}</b> subit`;
      const btns = mineC ? `<div class="gb">${g.mode === 'once' ? `<button class="btn sm green" data-act="done" data-gi="${g.i}">✔ Fait</button>` : ''}<button class="btn sm red" data-act="fault" data-gi="${g.i}" data-all="${g.on === '*' ? 1 : 0}">🚨 Faute</button></div>` : '';
      return `<div class="srow${onMe ? ' onme' : ''}"><span class="se">${sp.emoji}</span><div class="st">${who} « ${esc(sp.name)} »<small>${esc(sp.effect)}</small>${btns}</div>${g.exp ? `<span class="tmr" data-exp="${g.exp}">⏱ ${fmtT(g.exp - t)}</span>` : '<span class="tmr">mission</span>'}</div>`;
    }).join('');
  }
  function rankHTML() {
    const S = App.S, me = seat();
    return S.players.slice().sort((a, b) => E.spellSum(a) - E.spellSum(b) || a.spells.length - b.spells.length).map((p, i) => {
      const pts = E.spellSum(p), pct = Math.max(0, Math.min(100, (S.target - pts) / S.target * 100));
      return `<div class="rrow${me && p.id === me.id ? ' me' : ''}" data-pid="${esc(p.id)}"><b>${i + 1}</b>${avatar(p)}<div class="rn"><span>${esc(p.name)}</span><small>📜 ${p.spells.length} sort${p.spells.length > 1 ? 's' : ''} · ⭐ ${pts} pt${pts > 1 ? 's' : ''}</small><div class="rbar"><i style="width:${pct}%"></i></div></div></div>`;
    }).join('');
  }
  function storyHTML(pd) {
    const me = seat(), t = byId(pd.on), isBy = me && pd.by === me.id, left = Math.max(0, Math.round((pd.end - Date.now()) / 1000));
    return `<div class="banner info">📖 <b>${esc(t.name)}</b> doit raconter une histoire sans s'arrêter ! <b id="story-t">${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</b>${isBy ? `<div style="display:flex;gap:6px;margin-top:6px"><button class="btn sm green" data-act="story" data-ok="1">✅ Il/elle a tenu</button><button class="btn sm red" data-act="story" data-ok="0">😴 A craqué</button></div>` : ''}</div>`;
  }

  /* ---------- Transactions : elles se jouent sur la table (qui s'agrandit) ---------- */
  let txSel = [], txTarget = null, txKey = '';
  const TXK = new Set(['marche', 'brocante', 'auction', 'pot']);
  const isTx = pd => !!(pd && TXK.has(pd.k));
  function txSync(pd) {
    const k = pd ? pd.id + ':' + (pd.st || '') + ':' + (pd.i || 0) : '';
    if (k !== txKey) { txKey = k; txSel = []; txTarget = null; }
    const me = seat(); txSel = me ? txSel.filter(c => me.hand.includes(c)) : [];
  }
  function txCap(pd) {
    if (pd.k === 'auction' && pd.st === 'lot') return 3;
    if (pd.k === 'brocante') return 2;
    if (pd.k === 'marche' && pd.st === 'reply') return pd.give.length;
    if (pd.k === 'pot' && pd.st === 'join') return pd.n;
    return 99;
  }
  function txHTML(pd) {
    const S = App.S, me = seat(), meId = me && me.id, nm = id => esc((byId(id) || {}).name || '?');
    const cd = pd.dl ? `<span class="cd" data-dl="${pd.dl}">${Math.max(0, Math.round((pd.dl - Date.now()) / 1000))}</span> s` : '';
    const head = (e, t, sub) => `<div class="txh"><b>${e} ${t}</b>${sub ? `<small>${sub}</small>` : ''}<span class="txc">⏱ ${cd}</span></div>`;
    const btn = (act, label, ok, cls) => `<button class="btn sm ${cls || ''}${ok ? '' : ' off'}" data-tx="${act}">${label}</button>`;
    const back = n => Array.from({ length: n }, () => '<div class="card mini back">?</div>').join('');
    switch (pd.k) {
      case 'marche': {
        const by = byId(pd.by);
        if (pd.st === 'offer') {
          if (meId !== pd.by) return head('🏪', 'Jour de marché') + `<p>${esc(by.name)} prépare une offre d'échange…</p>`;
          const t = txTarget && byId(txTarget);
          return head('🏪', 'Jour de marché', 'à toi de proposer') + `<p>Touche un joueur autour de la table, puis choisis dans ta main les trouvailles à lui proposer.</p><p class="txi">Échange avec : <b>${t ? esc(t.name) : '…'}</b> · ${txSel.length} carte${txSel.length > 1 ? 's' : ''}</p><div class="txb">${btn('m-offer', '🤝 Proposer', t && txSel.length >= 1 && txSel.length <= t.hand.length, 'green')}${btn('cancel', 'Annuler', true, 'ghost')}</div>`;
        }
        const t = byId(pd.to), k = pd.give.length;
        return head('🏪', 'Jour de marché', `${esc(by.name)} ⇄ ${esc(t.name)}`) + `<div class="offer">${pd.give.map(c => findCard(c, { mini: true })).join('')}<span class="arr">⇄</span>${back(k)}</div>` +
          (meId === pd.to ? `<p><b>${esc(by.name)}</b> te propose ${k} trouvaille${k > 1 ? 's' : ''} : choisis-en ${k} des tiennes en échange.</p><div class="txb">${btn('m-accept', '✅ Accepter', txSel.length === k, 'green')}${btn('m-no', '🙅 Refuser', true, 'red')}</div>` : `<p>${esc(by.name)} propose un échange à <b>${esc(t.name)}</b>…</p>`);
      }
      case 'brocante': {
        const inw = me && pd.wait.includes(me.id);
        return head('🛒', 'Brocante', '2 trouvailles contre 1 de la pioche') + `<div class="pot"><div class="card mini back">🂠<b>${S.deck.length}</b></div></div><div class="who">${pd.all.map(id => `<span class="${pd.wait.includes(id) ? '' : 'ok'}">${nm(id)} ${pd.wait.includes(id) ? '…' : '✅'}</span>`).join('')}</div>` +
          (inw ? `<p>Sélectionne 2 trouvailles de ta main et échange-les, autant de fois que tu veux.</p><div class="txb">${btn('b-swap', '🔁 Échanger 2 → 1', txSel.length === 2, 'green')}${btn('b-done', "✔ J'ai fini", true, 'ghost')}</div>` : `<p>${pd.all.includes(meId) ? 'Tu as terminé, patiente…' : 'Les autres joueurs troquent…'}</p>`);
      }
      case 'auction': {
        const by = byId(pd.by), isBy = meId === pd.by;
        if (pd.st === 'lot') return isBy ? head('🔨', 'Ventes aux enchères', 'choisis ton lot') + `<p>Sélectionne de 1 à 3 trouvailles de ta main à mettre aux enchères.</p><div class="txb">${btn('a-lot', "🔨 Lancer l'enchère", txSel.length >= 1 && txSel.length <= 3, 'green')}${btn('cancel', 'Annuler', true, 'ghost')}</div>` : head('🔨', 'Ventes aux enchères') + `<p>${esc(by.name)} choisit son lot…</p>`;
        const cur = pd.bid ? pd.bid.cards.length + (pd.bid.bonus || 0) : 0, top = pd.bid ? byId(pd.bid.by) : null;
        const canPre = me && pd.bid && pd.bid.by === me.id && me.hand.includes(E.PREUM) && !pd.bid.cards.includes(E.PREUM);
        return head('🔨', 'Ventes aux enchères', `lot de ${esc(by.name)}`) + `<div class="lot">${pd.lot.map(c => findCard(c, { mini: true })).join('')}</div><p class="txi">${top ? `Meilleure offre : <b>${esc(top.name)}</b> — ${cur} trouvaille${cur > 1 ? 's' : ''}${pd.bid.bonus ? ` (dont +${pd.bid.bonus} Passe-droit)` : ''}` : "Aucune offre pour l'instant."}</p>` +
          (isBy ? `<div class="txb">${btn('a-end', '🔨 Adjuger maintenant', true)}</div>` : `<div class="txb">${btn('a-bid', `💰 Enchérir (${txSel.length})`, txSel.length > cur, 'green')}${canPre ? btn('a-pre', '⏩ Passe-droit (+1)', true) : ''}</div><p class="txs">Sélectionne plus de ${cur} trouvaille${cur > 1 ? 's' : ''} dans ta main.</p>`);
      }
      case 'pot': {
        const by = byId(pd.by), isBy = meId === pd.by;
        if (pd.st === 'put') return isBy ? head('🍲', 'Pot commun', 'remplis le pot') + `<p>Sélectionne les trouvailles que tu mets dans le pot : les autres devront en mettre autant pour le rejoindre.</p><div class="txb">${btn('p-put', `🍲 Remplir le pot (${txSel.length})`, txSel.length >= 1, 'green')}${btn('cancel', 'Annuler', true, 'ghost')}</div>` : head('🍲', 'Pot commun') + `<p>${esc(by.name)} prépare le pot…</p>`;
        if (pd.st === 'join') {
          const inw = me && pd.wait.includes(me.id);
          return head('🍲', 'Pot commun', `${pd.n} par joueur`) + `<div class="pot">${back(pd.pot.length)}</div><div class="who">${pd.parts.map(id => `<span class="ok">${nm(id)} ✅</span>`).join('')}${pd.wait.map(id => `<span>${nm(id)} …</span>`).join('')}</div>` +
            (inw ? `<p>Mets <b>${pd.n}</b> trouvaille${pd.n > 1 ? 's' : ''} dans le pot pour le rejoindre.</p><div class="txb">${btn('p-join', `🍲 Rejoindre (${txSel.length}/${pd.n})`, txSel.length === pd.n, 'green')}${btn('p-no', 'Passer', true, 'ghost')}</div>` : '<p>En attente des autres joueurs…</p>');
        }
        const who = pd.order[pd.i % pd.order.length], my = meId === who;
        return head('🍲', 'Pot commun', `au tour de ${nm(who)}`) + `<div class="pot open">${pd.pot.map((c, k) => `<div class="pc${my ? ' pick' : ''}" data-tx="p-take" data-ci="${k}">${findCard(c, { mini: true })}</div>`).join('')}</div><p>${my ? '👉 À toi : touche la trouvaille que tu veux !' : `${nm(who)} choisit…`}</p>`;
      }
    }
    return '';
  }
  function txAct(el) {
    const a = el.dataset.tx, ans = o => { Sfx.play('click'); txSel = []; App.act(Object.assign({ t: 'ans' }, o)); }, cards = txSel.slice();
    switch (a) {
      case 'cancel': return ans({ a: 'cancel' });
      case 'm-offer': return ans({ a: 'offer', to: txTarget, cards });
      case 'm-accept': return ans({ a: 'accept', cards });
      case 'm-no': return ans({ a: 'no' });
      case 'b-swap': return ans({ a: 'swap', cards });
      case 'b-done': return ans({ a: 'done' });
      case 'a-lot': case 'a-bid': case 'p-put': return ans({ cards });
      case 'a-pre': return ans({ pre: 1 });
      case 'a-end': return ans({ a: 'end' });
      case 'p-join': return ans({ a: 'join', cards });
      case 'p-no': return ans({ a: 'no' });
      case 'p-take': return ans({ ci: +el.dataset.ci });
    }
  }

  /* ---------- Main : trouvailles triées par type (le coin en haut à droite indique le type) ---------- */
  function handHTML(me, tx) {
    const hand = me.hand.slice();
    let items;
    if (tx) items = hand.map(c => ({ c, sel: txSel.includes(c) }));
    else { const g = groupIng(hand), seen = new Set(); items = []; hand.forEach(c => { if (E.isIng(c)) { const k = E.ingOf(c); if (seen.has(k)) return; seen.add(k); items.push({ c: g[k][0], n: g[k].length, sel: sel && sel.ing === k }); } else items.push({ c, sel: sel && sel.id === c }); }); }
    if (!items.length) return '<small style="opacity:.7">Main vide</small>';
    return items.map((it, i) => findCard(it.c, { n: it.n, sel: it.sel, z: 60 - i })).join('');
  }
  function detailHTML() {
    const S = App.S, me = seat(); if (!sel || !me) return '';
    if (sel.t === 'spell') {
      if (!me.spells.includes(sel.id)) return ''; const sp = spellOf(sel.id), c = E.canCast(S, me, sp);
      return `<div class="detail"><button class="dx" data-act="closedet" title="Fermer">✕</button><div class="dcard">${fullSpell(sel.id, true)}</div><div class="dbody"><div class="dh"><b>${esc(sp.name)}</b><span class="lvtag">${LV[sp.level]}</span></div><div class="dt">${esc(sp.effect)}</div><div class="di">${chips(sp, me.hand).replace(/<span class="(miss)?" title="([^"]*)">(.*?)<\/span>/g, (m, ms, t, e) => `<span class="${ms || ''}">${e} ${esc(t)}</span>`)}</div>
        ${!c.ok ? `<div class="why">${esc(c.why)}</div>` : ''}<button class="btn ${c.ok && myTurn() ? '' : 'off'}" data-act="cast" data-sid="${sp.id}">🪄 Lancer</button></div></div>`;
    }
    if (!me.hand.includes(sel.id) && sel.t === 'find' && !(sel.ing != null)) return '';
    if (sel.ing != null) {
      const g = D.ingredients[sel.ing], need = me.spells.filter(s => spellOf(s).ing.includes(sel.ing));
      return `<div class="detail"><button class="dx" data-act="closedet" title="Fermer">✕</button><div class="dcard">${fullCard(sel.id, true)}</div><div class="dbody"><div class="dh"><b>${esc(g.name)}</b><span class="lvtag">Ingrédient</span></div><div class="dt">Sert pour : ${need.length ? need.map(s => esc(spellOf(s).name)).join(', ') : 'aucun de tes sortilèges (monnaie d\'échange !)'}</div></div></div>`;
    }
    const i = E.cardInfo(sel.id), noPlay = i.kind === 'obj' && E.NOPLAY.has(i.key);
    return `<div class="detail"><button class="dx" data-act="closedet" title="Fermer">✕</button><div class="dcard">${fullCard(sel.id, true)}</div><div class="dbody"><div class="dh"><b>${esc(i.name)}</b><span class="lvtag">${TYPE_LBL[typeOf(sel.id)]}</span></div><div class="dt">${esc(i.effect)}</div>${noPlay ? '' : `<button class="btn ${myTurn() ? '' : 'off'}" data-act="play" data-cid="${sel.id}">▶️ Jouer</button>`}</div></div>`;
  }
  let sideTab = 'sorts';
  function renderTable() {
    const S = App.S, me = seat(), T = $('#table'), cur = S.players[S.turn], mine = myTurn(), pend = S.pend, zoom = S.phase === 'play' && isTx(pend);
    txSync(zoom ? pend : null);
    const spectator = !me, n = S.players.length, ord = [];
    if (me) { const i = S.players.indexOf(me); for (let k = 0; k < n; k++) ord.push(S.players[(i + k) % n]); } else ord.push(...S.players);
    const turnTxt = S.phase === 'end' ? '🏁 Partie terminée' : mine ? '🎯 À TOI DE JOUER !' : `${S.dir > 0 ? '↻' : '↺'} Tour de ${esc(cur.name)}${S.extra ? ' (+' + S.extra + ')' : ''}`;
    const topD = S.discard.length ? findCard(S.discard[S.discard.length - 1], { mini: true }) : '<span class="em">🗑️</span>';
    const piles = `<div class="tpiles"><div class="pile" data-act="deck"><span class="em">🂠</span><b>${S.deck.length}</b>pioche</div><div class="pile" data-act="disc">${topD}<small>défausse ${S.discard.length}</small></div></div>`;
    const strip = [
      spectator ? '<div class="banner">👀 Tu regardes la partie.</div>' : '',
      pend && !zoom ? (pend.k === 'story' ? storyHTML(pend) : `<div class="banner ${pend.k === 'react' && me && pend.on === me.id ? 'alert' : ''}">${esc(pendText(pend))}</div>`) : '',
      S.lum ? `<div class="banner">💡 Lumière : les trouvailles piochées / défaussées sont visibles.</div>` : '',
      S.reveal ? `<div class="banner">🔔 Mains visibles jusqu'à la fin du tour de ${esc(byId(S.reveal).name)} !</div>` : '',
      S.timer && cur.id === S.timer.pid ? `<div class="banner alert">⏳ ${esc(cur.name)} : <b id="timer-t">${Math.max(0, Math.round((S.timer.dl - Date.now()) / 1000))}</b> s</div>` : ''
    ].join('');
    T.innerHTML = `
      <div class="hdr"><span class="room">🧪 ${esc(App.room)}</span><div class="turnb${mine ? ' me' : ''}">${turnTxt}</div>
        <button class="ibtn" data-act="snd">${Sfx.muted ? '🔇' : '🔊'}</button><button class="ibtn" data-act="rules">❓</button><button class="ibtn" data-act="cat">📖</button></div>
      ${strip ? `<div class="strip">${strip}</div>` : ''}
      <div class="board${zoom ? ' zoom' : ''}">
        <div class="felt">${ord.map((p, i) => seatHTML(p, i, n, zoom)).join('')}
          <div class="tcircle${zoom ? ' zoom' : ''}">${zoom ? `<div class="txbody">${txHTML(pend)}</div>${piles}` : `<div class="tl">TABLE DE JEU</div>${piles}`}</div></div>
        <aside class="side" data-tab="${sideTab}">
          <div class="tabs3"><button data-sidetab="rank">🏆 Classement</button><button data-sidetab="sorts">🎭 Sorts${S.gages.length ? ' (' + S.gages.length + ')' : ''}</button><button data-sidetab="hist">📜 Historique</button></div>
          <section class="box rk"><h4>🏆 Classement <small>points et sorts restants</small></h4>${rankHTML()}</section>
          <section class="box gg"><h4>🎭 Sorts en cours <small>⏱ 5 min</small></h4>${sortsHTML()}</section>
          <section class="box hs" data-act="log"><h4>📜 Historique des coups</h4>${S.log.slice().reverse().map(l => `<div>${esc(l)}</div>`).join('')}</section>
        </aside>
      </div>
      ${me ? `<div class="mine${zoom ? ' zoom' : ''}"><div class="scroll">
        <div class="sec hsec"><div class="row-lbl"><span class="lbl">🃏 TROUVAILLES (${me.hand.length})</span><span class="legend"><i class="corner ing"></i>ingrédient <i class="corner obj"></i>objet <i class="corner junk"></i>inutile <i class="corner tr"></i>transaction</span></div>
          <div class="hand">${handHTML(me, zoom)}</div></div>
        <div class="sec ssec"><div class="row-lbl"><span class="lbl">📜 SORTILÈGES (${me.spells.length}) · ⭐ ${E.spellSum(me)} pts</span><span>${me.cast.map(s => spellOf(s).emoji).join(' ')} ${flagsOf(me)}</span></div>
          <div class="spells">${me.spells.map(s => spellCard(s, { hand: me.hand, can: mine && E.canCast(S, me, spellOf(s)).ok, sel: sel && sel.t === 'spell' && sel.id === s })).join('') || '<small style="opacity:.7">Plus aucun sortilège !</small>'}</div></div>
      </div>
        ${zoom ? '' : detailHTML()}
        <div class="bar"><button class="btn big grow ${mine ? '' : 'off'}" data-act="end">${mine ? '✅ Fin du tour' : '⏳ Patiente…'}</button><div class="emos">${['😂', '🔥', '💀', '👏'].map(e => `<button data-act="emo" data-e="${e}">${e}</button>`).join('')}</div></div></div>` : ''}`;
    attachTable(T);
  }
  function attachTable(T) {
    T.onclick = e => {
      const S = App.S, me = seat(), el = e.target.closest('[data-act],[data-tx],[data-sidetab],[data-cid],[data-sid],[data-pid]'); if (!el) return;
      const act = el.dataset.act, pd = S.pend, zoom = S.phase === 'play' && isTx(pd);
      if (el.dataset.sidetab) { sideTab = el.dataset.sidetab; return renderTable(); }
      if (el.dataset.tx) return txAct(el);
      if (act === 'closedet') { sel = null; Sfx.play('click'); return renderTable(); }
      if (act === 'cast') return doCast(+el.dataset.sid);
      if (act === 'play') return doPlay(+el.dataset.cid);
      if (act === 'end') { Sfx.play('click'); sel = null; return App.act({ t: 'end' }); }
      if (act === 'snd') { Sfx.toggle(); return renderTable(); }
      if (act === 'rules') return showRules();
      if (act === 'cat') return showCatalog();
      if (act === 'emo') return App.emote(el.dataset.e);
      if (act === 'log') return showLog();
      if (act === 'deck') return toast(`${S.deck.length} carte(s) dans la pioche.`);
      if (act === 'disc') return showDiscard();
      if (act === 'done') return App.act({ t: 'done', gi: +el.dataset.gi });
      if (act === 'fault') {
        const gi = +el.dataset.gi;
        if (el.dataset.all === '1') return pick({ title: '🚨 Qui est en faute ?', items: S.players.filter(p => p.id !== me.id).map(p => ({ id: p.id, html: avatar(p) + '<span>' + esc(p.name) + '</span>', cls: 'pplayer' })) }).then(r => r && App.act({ t: 'fault', gi, who: r[0] }));
        return App.act({ t: 'fault', gi });
      }
      if (act === 'story') return App.act({ t: 'ans', ok: el.dataset.ok === '1' });
      if (el.dataset.sid && !act) {
        const sid = +el.dataset.sid; if (el.classList.contains('cb')) return showSpellInfo(sid);
        sel = { t: 'spell', id: sid }; Sfx.play('click'); return renderTable();
      }
      if (el.dataset.cid && !act) {
        const cid = +el.dataset.cid; Sfx.play('click');
        if (zoom) { // pendant une transaction : on (dé)sélectionne les cartes de sa main
          if (!me || !me.hand.includes(cid)) return;
          const k = txSel.indexOf(cid); if (k >= 0) txSel.splice(k, 1); else { txSel.push(cid); while (txSel.length > txCap(pd)) txSel.shift(); }
          return renderTable();
        }
        sel = E.isIng(cid) ? { t: 'find', ing: E.ingOf(cid), id: cid } : { t: 'find', id: cid }; return renderTable();
      }
      if (el.dataset.pid) {
        if (zoom && pd.k === 'marche' && pd.st === 'offer' && me && pd.by === me.id && !el.classList.contains('rrow')) {
          const t = byId(el.dataset.pid); if (!t || t === me || t.off) return;
          if (t.lock) return toast(`${t.name} est protégé : impossible de lui échanger quoi que ce soit.`, 'err');
          if (!t.hand.length) return toast(`${t.name} n'a plus de trouvaille.`, 'err');
          txTarget = t.id; Sfx.play('click'); return renderTable();
        }
        return showPlayerInfo(el.dataset.pid);
      }
    };
  }

  /* ---------- Fenêtres d'information ---------- */
  function showSpellInfo(sid) {
    const sp = spellOf(sid);
    const m = openModal(`<div class="panel"><div class="cine-emoji" style="font-size:54px;text-align:center">${sp.emoji}</div><h3 style="text-align:center">${esc(sp.name)} <small>(${LV[sp.level]})</small></h3><p>${esc(sp.effect)}</p><div class="spells" style="justify-content:center">${sp.ing.map(g => `<div class="card mini" style="--c:${D.ingredients[g].color}"><div class="em">${D.ingredients[g].emoji}</div><div class="nm">${esc(D.ingredients[g].name)}</div></div>`).join('')}</div><div class="foot"><button class="btn" data-x>OK</button></div></div>`);
    m.onclick = e => { if (e.target.closest('[data-x]') || e.target === m) closeModal(true); };
  }
  function showPlayerInfo(pid) {
    const S = App.S, p = byId(pid); if (!p) return;
    const m = openModal(`<div class="panel"><h3>${avatar(p)} ${esc(p.name)}</h3><p>🃏 ${p.hand.length} trouvaille(s) · 📜 ${p.spells.length} sortilège(s) à lancer · ✅ ${p.cast.length} lancé(s)</p><p>${flagsOf(p) || ''}</p>
      ${p.cast.length ? `<div class="spells">${p.cast.map(s => spellCard(s)).join('')}</div>` : ''}
      ${S.gages.filter(g => g.on === p.id).map(g => `<p>🎭 <b>${esc(spellOf(g.sid).name)}</b> : ${esc(spellOf(g.sid).effect)}</p>`).join('')}<div class="foot"><button class="btn" data-x>OK</button></div></div>`);
    m.onclick = e => { if (e.target.closest('[data-x]') || e.target === m) closeModal(true); const s = e.target.closest('[data-sid]'); if (s) showSpellInfo(+s.dataset.sid); };
  }
  function showLog() {
    const m = openModal(`<div class="panel logfull"><h3>📜 Historique</h3>${App.S.log.slice().reverse().map(l => `<div>${esc(l)}</div>`).join('')}<div class="foot"><button class="btn" data-x>OK</button></div></div>`);
    m.onclick = e => { if (e.target.closest('[data-x]') || e.target === m) closeModal(true); };
  }
  function showDiscard() {
    const S = App.S, m = openModal(`<div class="panel"><h3>🗑️ Défausse (${S.discard.length})</h3><div class="grid" style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center">${S.discard.slice().reverse().map(c => findCard(c, { mini: true })).join('') || '<small>Vide</small>'}</div><div class="foot"><button class="btn" data-x>OK</button></div></div>`);
    m.onclick = e => { if (e.target.closest('[data-x]') || e.target === m) closeModal(true); };
  }
  function showRules() {
    const m = openModal(`<div class="panel rules"><h3>❓ Comment jouer</h3>
      <p>🎯 <b>But :</b> être le premier à avoir lancé <b>tous ses sortilèges</b>.</p>
      <p>🃏 <b>Ton tour :</b> tu pioches une trouvaille, puis tu joues autant de cartes que tu veux, puis tu termines ton tour.</p>
      <ul><li>🪄 <b>Lancer un sort :</b> tu défausses les ingrédients dessinés dessus (niveau = nombre d'ingrédients). La baguette magique remplace n'importe quel ingrédient.</li>
      <li>🎭 <b>Gages :</b> la plupart des sorts de niveau 1 imposent un gage à un joueur. S'il oublie, <b>tu appuies sur 🚨 Faute</b> et tu lui prends une trouvaille au hasard !</li>
      <li>😬 <b>Quand un sort te vise :</b> tu peux subir, te racheter (2 trouvailles au lanceur), jouer le Creuset de Mikaël (annule) ou lancer « Celui qui dit qui est » (renvoie).</li>
      <li>🔒 Certains effets te protègent (Cadenat, Peignoir d'été, Bouclier noir, Protection, Mur de Vent).</li>
      <li>⏱ <b>Gages :</b> les sorts à effet continu durent <b>5 minutes</b>, puis prennent fin tout seuls (le chrono est dans « Sorts en cours »).</li>
      <li>🏪 <b>Transactions</b> (sur la table) : <b>Jour de marché</b> (tu proposes un échange libre à un joueur), <b>Brocante</b> (2 trouvailles contre 1 de la pioche, à volonté), <b>Ventes aux enchères</b> (jusqu'à 3 trouvailles, on surenchérit en nombre de trouvailles, 30 s), <b>Pot commun</b> (chacun met autant que le lanceur, puis on se sert à tour de rôle).</li>
      <li>🎨 Coin en haut à droite des cartes : jaune = ingrédient, bleu = objet, rouge = objet inutile, violet = transaction, orange = sortilège.</li>
      <li>🛠️ Touche une carte pour voir son effet, puis « Lancer » ou « Jouer ». Touche un joueur pour voir ses sorts lancés.</li></ul>
      <div class="foot"><button class="btn" data-x>Compris !</button></div></div>`);
    m.onclick = e => { if (e.target.closest('[data-x]') || e.target === m) closeModal(true); };
  }
  function showCatalog(tab) {
    tab = tab || 'sp';
    const body = tab === 'sp' ? [1, 2, 3, 4].map(l => `<h4>${'★'.repeat(l)} Niveau ${l}</h4>` + D.spells.filter(s => s.level === l).map(s => `<div class="catline"><span class="e">${s.emoji}</span><div><b>${esc(s.name)}</b> ${s.ing.map(g => D.ingredients[g].emoji).join('')}<small>${esc(s.effect)}</small></div></div>`).join('')).join('')
      : tab === 'ob' ? D.objects.map(o => `<div class="catline"><span class="e">${o.emoji}</span><div><b>${esc(o.name)}</b><small>${esc(o.effect)}</small></div></div>`).join('') + D.transactions.map(o => `<div class="catline"><span class="e">${o.emoji}</span><div><b>${esc(o.name)}</b> (×3)<small>${esc(o.effect)}</small></div></div>`).join('')
      : D.ingredients.map(g => `<div class="catline"><span class="e">${g.emoji}</span><div><b>${esc(g.name)}</b><small>×4 dans la pioche</small></div></div>`).join('');
    const m = openModal(`<div class="panel"><h3>📖 Toutes les cartes</h3><div class="tabs"><button class="btn sm ${tab === 'sp' ? '' : 'ghost'}" data-t="sp">Sortilèges</button><button class="btn sm ${tab === 'ob' ? '' : 'ghost'}" data-t="ob">Objets</button><button class="btn sm ${tab === 'in' ? '' : 'ghost'}" data-t="in">Ingrédients</button></div>${body}<div class="foot"><button class="btn" data-x>OK</button></div></div>`);
    m.onclick = e => { if (e.target.closest('[data-x]') || e.target === m) return closeModal(true); const t = e.target.closest('[data-t]'); if (t) showCatalog(t.dataset.t); };
  }

  function showEnd() {
    const S = App.S, w = byId(S.winner[0]), me = seat(), won = me && S.winner.includes(me.id);
    const rank = S.players.slice().sort((a, b) => (S.winner.includes(b.id) - S.winner.includes(a.id)) || a.spells.length - b.spells.length);
    const m = openModal(`<div class="panel end"><div class="crown">${won ? '🏆' : '👑'}</div><h2>${won ? 'TU AS GAGNÉ !' : esc(w.name) + ' gagne !'}</h2><p>${won ? 'Maître absolu du concours de magie !' : 'Tous ses sortilèges sont lancés.'}</p>
      <div class="rank">${rank.map((p, i) => `<div class="${S.winner.includes(p.id) ? 'w' : ''}"><b>${i + 1}</b>${avatar(p)}<span style="flex:1;text-align:left">${esc(p.name)}</span><span>📜 ${p.spells.length} restant${p.spells.length > 1 ? 's' : ''}</span></div>`).join('')}</div>
      ${App.isHost ? '<button class="btn big" style="width:100%" data-r>🔁 Rejouer</button>' : '<p>⏳ L\'hôte peut relancer une partie.</p>'}<button class="btn ghost" style="margin-top:8px" data-x>Voir la table</button></div>`, null);
    m.onclick = e => { if (e.target.closest('[data-r]')) { closeModal(true); App.startGame(S.target); } else if (e.target.closest('[data-x]')) closeModal(true); };
  }

  /* ---------- Rendu général ---------- */
  function render() {
    const S = App.S;
    if (!S) { renderLobby(); show('lobby'); return; }
    if (S.phase === 'setup') { renderSetup(); show('setup'); syncPrompt(); return; }
    renderTable(); show('table'); syncPrompt();
  }
  function tickClock() { // compteurs vivants
    const S = App.S; if (!S) return;
    const t = $('#timer-t'); if (t && S.timer) t.textContent = Math.max(0, Math.round((S.timer.dl - Date.now()) / 1000));
    $$('.cd[data-dl]').forEach(x => { x.textContent = Math.max(0, Math.round((+x.dataset.dl - Date.now()) / 1000)); });
    $$('.tmr[data-exp]').forEach(x => { x.textContent = '⏱ ' + fmtT(+x.dataset.exp - Date.now()); });
    const st = $('#story-t'); if (st && S.pend && S.pend.k === 'story') { const l = Math.max(0, Math.round((S.pend.end - Date.now()) / 1000)); st.textContent = Math.floor(l / 60) + ':' + String(l % 60).padStart(2, '0'); }
  }
  setInterval(tickClock, 500);

  Object.assign(App, { render, toast, show, showEnd, showRules, esc, avatar, closeModal, fullCard, fullSpell, fullTr, resetSel() { sel = null; }, cancelPrompt() { promptKey = ''; closeModal(true); }, centerOfPlayer(id) { return FX.centerOf($(`[data-pid="${CSS.escape(id)}"]`)); }, spellOf });
})();
