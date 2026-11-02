/* Élixir — moteur de règles (sans DOM). Seul l'hôte de la salle l'exécute ;
   les autres joueurs envoient leurs intentions et reçoivent l'état complet. */
(function (root) {
  'use strict';
  const D = root.DATA;
  const N_ING = 64, OBJ0 = 64, TR0 = 103, N_TROUV = 112;
  const WAND = OBJ0 + D.objects.findIndex(o => o.key === 'baguette');
  const CAPE = OBJ0 + D.objects.findIndex(o => o.key === 'cape');
  const PREUM = OBJ0 + D.objects.findIndex(o => o.key === 'preum');
  const MIRROR = D.spells.find(s => s.key === 'miroir');
  class Err extends Error {}
  const bad = m => { throw new Err(m); };

  let S = null; // état courant (affecté par apply / tick)

  /* ---------- Cartes ---------- */
  const isIng = c => c < N_ING;
  const ingOf = c => c >> 2;
  const isObj = c => c >= OBJ0 && c < TR0;
  const isTr = c => c >= TR0;
  const objOf = c => D.objects[c - OBJ0];
  const trOf = c => D.transactions[((c - TR0) / 3) | 0];
  const USELESS = new Set(['bourse', 'torche', 'corde', 'couteau', 'cafe', 'jambon', 'epee', 'balai', 'cle', 'chaussette']);
  const NOPLAY = new Set(['baguette', 'cape', 'preum']);
  function cardInfo(c) {
    if (isIng(c)) { const g = D.ingredients[ingOf(c)]; return { kind: 'ing', name: g.name, emoji: g.emoji, color: g.color, ing: g.id, effect: 'Ingrédient — sert à lancer des sortilèges.' }; }
    if (isObj(c)) { const o = objOf(c); return { kind: 'obj', key: o.key, name: o.name, emoji: o.emoji, effect: o.effect, useless: USELESS.has(o.key) }; }
    const t = trOf(c); return { kind: 'tr', key: t.key, name: t.name, emoji: t.emoji, effect: t.effect };
  }
  const cname = c => cardInfo(c).name;

  /* ---------- Règles des sortilèges : paramètres demandés, réaction possible, etc. ---------- */
  const GAGE = { need: ['player'], hostile: 1, mode: 'gage' }, ONCE = { need: ['player'], hostile: 1, mode: 'once' };
  const HIT = { need: ['player'], hostile: 1 }, STEAL = { need: ['player'], hostile: 1, steal: 1 }, NONE = { need: [] };
  const META = {
    poil: GAGE, saper: GAGE, croa: GAGE, autaf: ONCE, bougeotte: ONCE, lechebottes: GAGE, rimaille: GAGE, perplexe: HIT,
    septvoiles: ONCE, pinson: GAGE, grrrh: GAGE, cabriole: ONCE, jolicoeur: GAGE, langue: ONCE, echo: GAGE, muet: GAGE,
    transfert: { need: ['gage', 'player'], hostile: 1 }, annulation: NONE, ressort: NONE, tournesort: NONE, braquage: STEAL,
    lumiere: NONE, affaires: NONE, generosite: NONE, beurk: { need: ['player', 'ing'], hostile: 1, steal: 1 }, abracada: NONE,
    surprise: NONE, bisque: HIT, troc: { need: ['cards:2', 'player'], hostile: 1, steal: 1 }, voleur: NONE, melange: NONE,
    contresens: NONE, dommage: { need: ['castOf'], hostile: 1 }, embrouille: { need: ['spell', 'player'], hostile: 1 },
    duplicata: { need: ['dup'] }, cadeau: { need: ['cards:1-3', 'player'] }, magot: STEAL, aristo: { need: [], mode: 'gage', all: 1 },
    notre: GAGE, pickpocket: STEAL, miroir: { need: [], reactOnly: 1 }, supertroc: STEAL, tourniquet: NONE, pagaille: NONE,
    coupmaitre: { need: ['sub'] }, illusion: { need: ['spell12'] }, shehe: HIT, racket: NONE, reveil: HIT, elixir: { need: ['sub'] },
    ubiquite: NONE, taxe: NONE, tornade: NONE, arnaque: STEAL, monstrueux: HIT, forteresse: NONE
  };
  const OMETA = {
    gants: { need: ['player'], steal: 1 }, aimant: { need: ['ing'] }, transmut: { need: ['myIng', 'discIng'] }, echange: { need: ['player'], steal: 1 },
    bongenie: { need: ['disc:1'] }, philtre: { need: ['player'], steal: 1 }, boule: { need: ['order'] }, edredon: { need: ['player'] },
    poubelle: { need: ['cards:0-9'] }, bouclier: { need: ['gage'] }, aspirateur: { need: ['disc:2'] }, chaudron: { need: ['cards:2'] },
    chapeau: { need: ['sub1'] }, grimoire: { need: ['spell'] }, sablier: { need: ['player'] }, loupe: { need: ['player'], steal: 1 }
  };

  /* ---------- Utilitaires ---------- */
  const rand = n => Math.floor(Math.random() * n);
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const P = id => S.players.find(p => p.id === id);
  const now = () => Date.now();
  const spellSum = p => p.spells.reduce((n, s) => n + D.spells[s].level, 0);
  function log(m) { S.log.push(m); if (S.log.length > 40) S.log.shift(); }
  function fx(k, d) { S.fxn++; S.fxq.push(Object.assign({ i: S.fxn, k }, d || {})); if (S.fxq.length > 8) S.fxq.shift(); }
  const nextIdx = i => (((i + S.dir) % S.players.length) + S.players.length) % S.players.length;
  const ring = f => S.players.filter(f);
  const discardCards = (p, cids) => { for (const c of cids) { const k = p.hand.indexOf(c); if (k >= 0) { p.hand.splice(k, 1); S.discard.push(c); } } };
  const own = (p, cids, n) => { const ok = (cids || []).filter((c, i, a) => p.hand.includes(c) && a.indexOf(c) === i).slice(0, n); const rest = shuffle(p.hand.filter(c => !ok.includes(c))); while (ok.length < n && rest.length) ok.push(rest.pop()); return ok; };

  function draw(p, n) {
    const got = [];
    for (let i = 0; i < n; i++) {
      if (!S.deck.length) { if (!S.discard.length) break; S.deck = shuffle(S.discard); S.discard = []; log('♻️ La défausse est remélangée dans la pioche.'); }
      const c = S.deck.shift(); p.hand.push(c); got.push(c);
    }
    return got;
  }
  function lumNote(p, verb, cids) { if (S.lum && S.lum.by !== p.id && cids.length) log(`💡 ${p.name} ${verb} : ${cids.map(cname).join(', ')}`); }

  function steal(from, to, n) {
    if (from.lock) { log(`🔒 ${from.name} est protégé : rien à prendre.`); fx('lock', { id: from.id }); return 0; }
    let k = 0;
    while (k < n && from.hand.length) { to.hand.push(from.hand.splice(rand(from.hand.length), 1)[0]); k++; }
    if (k) fx('steal', { from: from.id, to: to.id, n: k });
    else log(`${from.name} n'a plus rien à prendre.`);
    return k;
  }
  function takeAll(from, to, test, what) {
    if (from.lock) { log(`🔒 ${from.name} est protégé.`); fx('lock', { id: from.id }); return; }
    const m = from.hand.filter(test); from.hand = from.hand.filter(c => !test(c)); to.hand.push(...m);
    log(`${to.name} rafle ${m.length} ${what} à ${from.name}.`); if (m.length) fx('steal', { from: from.id, to: to.id, n: m.length });
  }
  function unCast(p, sid) {
    const k = p.cast.indexOf(sid); if (k < 0) return; p.cast.splice(k, 1); p.spells.push(sid);
    S.gages = S.gages.filter(g => !(g.sid === sid));
    const key = D.spells[sid].key;
    if (key === 'racket') S.racket = S.racket.filter(x => x !== p.id);
    if (key === 'taxe' && S.taxe === p.id) S.taxe = null;
    if (key === 'forteresse') p.wall = 0;
  }

  /* ---------- Création de partie ---------- */
  function newGame(list, opts) {
    const piles = { 1: [], 2: [], 3: [], 4: [] };
    D.spells.forEach(s => piles[s.level].push(s.id));
    for (const k in piles) shuffle(piles[k]);
    S = {
      v: opts.v || 0, gid: opts.gid, phase: 'setup', target: opts.target || 9,
      players: list.map(x => ({ id: x.id, name: String(x.name || 'Joueur').slice(0, 18), hand: [], spells: [], cast: [], shield: 0, lock: 0, untarget: 0, wall: 0, silence: 0, skip: 0, timed: 0, double: 0, off: 0 })),
      piles, deck: shuffle([...Array(N_TROUV).keys()]), discard: [], turn: 0, dir: 1, extra: 0, pend: null, q: [], pn: 0, gn: 0,
      gages: [], log: ['🧙 Choisissez vos sortilèges !'], fxq: [], fxn: 0, lastSpell: null, racket: [], taxe: null, lum: null, reveal: null, timer: null, winner: null
    };
    return S;
  }

  /* ---------- Préparation (choix des sortilèges) ---------- */
  function ready(p) {
    const sum = spellSum(p); if (sum >= S.target) return true;
    for (let l = 1; l <= 4; l++) if (l <= S.target - sum && S.piles[l].length) return false;
    return true;
  }
  function pickSpell(p, l) {
    if (S.phase !== 'setup') bad('La partie a déjà commencé.');
    l = +l; if (![1, 2, 3, 4].includes(l)) bad('Niveau invalide.');
    if (spellSum(p) + l > S.target) bad(`Tu dépasserais ${S.target} ingrédients !`);
    if (!S.piles[l].length) bad('Cette pile est vide.');
    p.spells.push(S.piles[l].pop()); checkSetup();
  }
  function autoSpells(p) {
    if (S.phase !== 'setup') bad('La partie a déjà commencé.');
    while (!ready(p)) {
      const room = S.target - spellSum(p), opts = [1, 2, 3, 4].filter(l => l <= room && S.piles[l].length);
      p.spells.push(S.piles[opts[rand(opts.length)]].pop());
    }
    checkSetup();
  }
  function checkSetup() { if (S.phase === 'setup' && S.players.every(ready)) startPlay(); }
  function startPlay() {
    S.phase = 'play'; S.players.forEach(p => { p.spells.sort((a, b) => D.spells[a].level - D.spells[b].level); draw(p, 5); });
    log('🎲 La partie commence !'); startTurn(rand(S.players.length));
  }

  /* ---------- Tours ---------- */
  function startTurn(i) {
    for (let guard = 0; guard <= S.players.length * 2; guard++) {
      S.turn = i; const p = S.players[i];
      p.lock = 0; p.untarget = 0;
      S.gages = S.gages.filter(g => !(g.on === p.id && g.key === 'muet'));
      if (S.lum) { if (S.lum.n <= 0) S.lum = null; else S.lum.n--; }
      if (p.off || p.skip) {
        log(p.off ? `⏭️ ${p.name} est absent : son tour est sauté.` : `⏭️ ${p.name} passe son tour !`); p.skip = 0; fx('skip', { id: p.id });
        i = nextIdx(i); continue;
      }
      const got = draw(p, 1); lumNote(p, 'pioche', got);
      fx('turn', { id: p.id });
      if (p.timed) { p.timed = 0; S.timer = { pid: p.id, dl: now() + 30000 }; log(`⏳ ${p.name} n'a que 30 secondes !`); }
      if (S.racket.includes(p.id)) S.q.push({ k: 'pickplayer', who: p.id, then: 'racket' });
      return;
    }
  }
  function endTurn() {
    const p = S.players[S.turn];
    p.silence = 0; if (S.reveal === p.id) S.reveal = null; if (S.timer && S.timer.pid === p.id) S.timer = null;
    if (S.extra > 0) { S.extra--; log(`⚡ ${p.name} rejoue !`); startTurn(S.turn); return; }
    startTurn(nextIdx(S.turn));
  }
  const mustTurn = p => { if (S.phase !== 'play') bad("La partie n'est pas en cours."); if (S.players[S.turn] !== p) bad("Ce n'est pas ton tour."); if (S.pend) bad('Une action est en cours, patiente.'); };

  /* ---------- Paiement ---------- */
  function payPlan(p, ings, minus) {
    const need = ings.slice(), hand = p.hand.slice(), pay = [], miss = [];
    for (const g of need) { const k = hand.findIndex(c => c < N_ING && (c >> 2) === g); if (k >= 0) pay.push(hand.splice(k, 1)[0]); else miss.push(g); }
    if (minus) { if (miss.length) miss.pop(); else pay.pop(); }
    if (miss.length > hand.filter(c => c === WAND).length) return null;
    for (let i = 0; i < miss.length; i++) pay.push(WAND);
    return pay;
  }

  /* ---------- Lancer un sortilège ---------- */
  function chk(c, sp, prm) {
    const has = (arr, n) => Array.isArray(arr) && arr.length === n && arr.every(x => c.hand.includes(x)) && new Set(arr).size === n;
    switch (sp.key) {
      case 'transfert': { const g = S.gages.find(g => g.i === prm.gi); if (!g || g.on !== c.id || g.mode === 'once') bad('Aucun gage à transférer.'); break; }
      case 'troc': if (!has(prm.cards, 2)) bad('Choisis 2 de tes trouvailles.'); break;
      case 'cadeau': if (!Array.isArray(prm.cards) || prm.cards.length < 1 || prm.cards.length > 3 || !has(prm.cards, prm.cards.length)) bad('Choisis 1 à 3 trouvailles.'); break;
      case 'embrouille': if (!c.spells.includes(prm.mine)) bad('Choisis un de tes sortilèges.'); break;
      case 'illusion': if (!c.spells.includes(prm.mine) || D.spells[prm.mine].level > 2) bad('Choisis un sortilège de niveau 1 ou 2.'); break;
      case 'beurk': if (!(prm.ing >= 0 && prm.ing < 16)) bad('Choisis un ingrédient.'); break;
      case 'dommage': { const t = P(prm.player); if (!t || !t.cast.includes(prm.sid)) bad('Choisis un sortilège déjà lancé.'); break; }
      case 'duplicata': if (S.lastSpell == null) bad("Aucun sortilège à copier pour l'instant."); break;
    }
  }
  function subCast(c, prm, o, only1) {
    const s = prm.sub; if (!s || s.sid == null) bad('Choisis un autre sortilège.');
    if (!c.spells.includes(s.sid)) bad("Ce sortilège n'est plus dans ta main.");
    const sp = D.spells[s.sid]; if (only1 && sp.level !== 1) bad('Un sortilège de niveau 1 seulement.');
    castSpell(c, sp, s.p || {}, o);
  }
  function castSpell(c, sp, prm, o) {
    o = o || {};
    if (c.silence) bad('Tu es réduit au silence !');
    if (META[sp.key].reactOnly && !o.react) bad('Ce sortilège se lance en réaction, quand on te vise.');
    if (!o.free) {
      const pay = payPlan(c, sp.ing, o.minus); if (!pay) bad('Il te manque des ingrédients.');
      for (const x of pay) { c.hand.splice(c.hand.indexOf(x), 1); S.discard.push(x); }
    }
    chk(c, sp, prm);
    c.spells.splice(c.spells.indexOf(sp.id), 1); c.cast.push(sp.id);
    const t = prm.player ? P(prm.player) : null;
    fx('cast', { sid: sp.id, by: c.id, on: t ? t.id : null });
    log(`${sp.emoji} ${c.name} lance « ${sp.name} »${t ? ' sur ' + t.name : ''} !`);
    launch(c, sp, prm, o);
    if (sp.key !== 'duplicata' && sp.key !== 'miroir') S.lastSpell = sp.id;
  }
  function launch(c, sp, prm, o) {
    const M = META[sp.key]; let t = null;
    if (M.need.includes('player') || M.need.includes('castOf')) {
      t = P(prm.player); if (!t || t === c) bad('Choisis un autre joueur.');
      if (t.untarget) bad(`${t.name} est intouchable ce tour-ci.`);
      if (t.wall && sp.level <= 2) bad(`${t.name} est derrière son Mur de Vent.`);
      if (M.steal && t.lock) bad(`${t.name} est protégé : rien à lui prendre.`);
      if (M.hostile && !o.mirrored) {
        if (t.shield && sp.level <= 2) { t.shield = 0; log(`🛡️ ${t.name} est protégé : « ${sp.name} » est annulé !`); fx('shield', { id: t.id }); return; }
        if (!t.off) { S.q.push({ k: 'react', by: c.id, on: t.id, sid: sp.id, prm, dl: now() + 25000 }); return; }
      }
    }
    effect(c, t, sp, prm || {}, o || {});
  }
  function run(c, t, sp, prm, o) {
    try { effect(c, t, sp, prm || {}, o || {}); } catch (e) { if (!(e instanceof Err)) throw e; log(`« ${sp.name} » reste sans effet (${e.message})`); }
  }
  function addGage(c, t, sp, mode) { S.gages.push({ i: ++S.gn, sid: sp.id, key: sp.key, by: c.id, on: t ? t.id : '*', mode }); }

  function effect(c, t, sp, prm, o) {
    const M = META[sp.key];
    if (M.mode) {
      addGage(c, t, sp, M.mode);
      log(M.all ? `👑 Tous les joueurs doivent obéir à ${c.name} !` : M.mode === 'once' ? `🎯 Mission pour ${t.name} : « ${sp.name} »` : `🎭 ${t.name} subit « ${sp.name} »`);
      return;
    }
    switch (sp.key) {
      case 'perplexe': t.skip = 1; log(`⏭️ ${t.name} passera son prochain tour.`); break;
      case 'transfert': { const g = S.gages.find(g => g.i === prm.gi); if (!g || g.on !== c.id) { log('Aucun gage à transférer.'); break; } g.on = t.id; log(`↪️ ${c.name} refile « ${D.spells[g.sid].name} » à ${t.name} !`); break; }
      case 'annulation': c.shield = 1; log(`🛡️ ${c.name} est protégé contre le prochain sort de niveau 1 ou 2.`); break;
      case 'ressort': S.gages = []; log('🔓 Tous les gages sont levés !'); break;
      case 'tournesort': {
        const w = ring(p => p.spells.length && !p.off).map(p => p.id);
        if (w.length < 2) { log('Pas assez de joueurs avec des sortilèges.'); break; }
        S.q.push({ k: 'multi', what: 'pass', wait: w, picks: {}, dl: now() + 45000 }); break;
      }
      case 'braquage': steal(t, c, 2); break;
      case 'lumiere': S.lum = { by: c.id, n: 2 }; log('💡 Pendant 2 tours, les trouvailles piochées et défaussées sont visibles !'); break;
      case 'affaires': openTransaction(0, c); break;
      case 'generosite': {
        const w = ring(p => p !== c && p.hand.length && !p.lock && !p.off).map(p => p.id);
        S.q.push({ k: 'multi', what: 'give', wait: w, picks: {}, to: c.id, n: 1, dl: now() + 45000 }); break;
      }
      case 'beurk': {
        if (t.lock) { log(`🔒 ${t.name} est protégé.`); break; }
        const rm = t.hand.filter(x => isIng(x) && ingOf(x) === prm.ing); t.hand = t.hand.filter(x => !rm.includes(x)); S.discard.push(...rm);
        log(`🤢 ${t.name} défausse ${rm.length} × ${D.ingredients[prm.ing].name}.`); break;
      }
      case 'abracada': {
        const ps = ring(p => !p.lock), pool = [];
        ps.forEach(p => { const m = p.hand.filter(isObj); p.hand = p.hand.filter(x => !isObj(x)); pool.push(...m); });
        shuffle(pool); pool.forEach((x, k) => ps[k % ps.length].hand.push(x)); log(`🎩 ${pool.length} objets sont redistribués !`); fx('boom'); break;
      }
      case 'surprise': draw(c, 3); log(`🎉 ${c.name} pioche 3 trouvailles.`); break;
      case 'bisque': t.silence = 1; log(`🔇 ${t.name} ne pourra pas lancer de sort à son prochain tour.`); break;
      case 'troc': {
        const mine = own(c, prm.cards, 2); const got = [];
        while (got.length < 2 && t.hand.length) got.push(t.hand.splice(rand(t.hand.length), 1)[0]);
        mine.forEach(x => { c.hand.splice(c.hand.indexOf(x), 1); t.hand.push(x); }); c.hand.push(...got);
        log(`🤝 ${c.name} troque 2 trouvailles avec ${t.name}.`); fx('steal', { from: t.id, to: c.id, n: got.length }); break;
      }
      case 'voleur': { log(`🦹 ${c.name} fait les poches de tout le monde !`); ring(p => p !== c).forEach(p => { if (p.hand.length && !p.lock) steal(p, c, 1); }); break; }
      case 'melange': {
        const ps = ring(() => true), pool = []; ps.forEach(p => { pool.push(...p.spells); p.spells = []; });
        shuffle(pool); pool.forEach((x, k) => ps[k % ps.length].spells.push(x));
        ps.forEach(p => p.spells.sort((a, b) => D.spells[a].level - D.spells[b].level)); log('🥣 Tous les sortilèges non lancés sont mélangés et redistribués !'); fx('boom'); break;
      }
      case 'contresens': S.dir *= -1; log('↩️ Le sens du jeu est inversé !'); fx('reverse'); break;
      case 'dommage': { const sid = prm.sid; if (!t.cast.includes(sid)) { log('Ce sortilège a disparu.'); break; } unCast(t, sid); t.spells.sort((a, b) => D.spells[a].level - D.spells[b].level); log(`😿 ${t.name} reprend « ${D.spells[sid].name} » en main.`); break; }
      case 'embrouille': {
        const mine = c.spells.includes(prm.mine) ? prm.mine : null; if (mine == null) { log('Sortilège introuvable.'); break; }
        const lv = D.spells[mine].level, cand = t.spells.filter(s => D.spells[s].level === lv);
        if (!cand.length) { log(`${t.name} n'a aucun sortilège de niveau ${lv}.`); break; }
        const theirs = cand[rand(cand.length)];
        c.spells.splice(c.spells.indexOf(mine), 1, theirs); t.spells.splice(t.spells.indexOf(theirs), 1, mine);
        log(`🌀 ${c.name} échange un sortilège de niveau ${lv} avec ${t.name} !`); break;
      }
      case 'duplicata': { const last = D.spells[S.lastSpell]; log(`📠 Duplicata copie « ${last.name} » !`); const sp2 = prm.sub || {}; chk(c, last, sp2.p || {}); launch(c, last, sp2.p || {}, { copy: 1 }); break; }
      case 'cadeau': { const m = own(c, prm.cards, 3); m.forEach(x => { c.hand.splice(c.hand.indexOf(x), 1); t.hand.push(x); }); log(`🎀 ${c.name} offre ${m.length} trouvaille(s) à ${t.name}.`); break; }
      case 'magot': takeAll(t, c, x => isObj(x), 'objets'); break;
      case 'pickpocket': S.q.push({ k: 'take', who: c.id, from: t.id, n: 2, dl: now() + 40000 }); break;
      case 'supertroc': {
        if (t.lock) { log(`🔒 ${t.name} est protégé.`); break; }
        [c.hand, t.hand] = [t.hand, c.hand]; draw(c, 1); log(`🔄 ${c.name} échange toute sa main avec ${t.name} !`); fx('steal', { from: t.id, to: c.id, n: c.hand.length }); break;
      }
      case 'tourniquet': { const ps = ring(p => !p.lock && !p.off); const hs = ps.map(p => p.hand); ps.forEach((p, i) => { p.hand = hs[(i - 1 + ps.length) % ps.length]; }); log('🎡 Chacun donne toutes ses trouvailles à son voisin de gauche !'); fx('boom'); break; }
      case 'pagaille': {
        const ps = ring(p => !p.lock), pool = []; ps.forEach(p => { pool.push(...p.hand); p.hand = []; });
        shuffle(pool); pool.forEach((x, k) => ps[k % ps.length].hand.push(x)); log('🌪️ Toutes les trouvailles sont mélangées et redistribuées !'); fx('boom'); break;
      }
      case 'coupmaitre': subCast(c, prm, { minus: 1 }); break;
      case 'illusion': { const s = prm.mine; if (!c.spells.includes(s)) break; c.spells.splice(c.spells.indexOf(s), 1); c.cast.push(s); log(`🪄 ${c.name} fait croire qu'il a lancé « ${D.spells[s].name} » (sans effet).`); break; }
      case 'shehe': { const end = now() + 180000; S.q.push({ k: 'story', by: c.id, on: t.id, end, dl: end + 60000 }); break; }
      case 'racket': if (!S.racket.includes(c.id)) S.racket.push(c.id); log(`💼 ${c.name} rackettera un joueur à chacun de ses tours !`); break;
      case 'reveil': {
        const back = t.cast.slice(); back.forEach(s => unCast(t, s)); t.spells.sort((a, b) => D.spells[a].level - D.spells[b].level);
        if (!t.lock) { S.discard.push(...t.hand); t.hand = []; draw(t, 5); }
        log(`☠️ ${t.name} reprend ${back.length} sortilège(s) et repart de zéro !`); fx('boom'); break;
      }
      case 'elixir': subCast(c, prm, { free: 1 }); break;
      case 'ubiquite': S.extra += 2; log(`🪨 ${c.name} jouera 2 tours de plus !`); break;
      case 'taxe': S.taxe = c.id; log(`💸 ${c.name} prélèvera une taxe à chaque transaction !`); break;
      case 'tornade': {
        ring(p => !p.lock || p === c).forEach(p => { S.discard.push(...p.hand); p.hand = []; draw(p, p === c ? 7 : 5); });
        log(`🌋 Tout le monde défausse sa main et repioche 5 (${c.name} : 7) !`); fx('boom'); break;
      }
      case 'arnaque': takeAll(t, c, x => isIng(x), 'ingrédients'); break;
      case 'monstrueux': { const s = S.piles[4].pop(); if (s == null) { log('Plus aucun sortilège de niveau 4 !'); break; } t.spells.push(s); log(`👹 ${t.name} hérite d'un sortilège de niveau 4 supplémentaire !`); break; }
      case 'forteresse': c.wall = 1; log(`🧱 ${c.name} est protégé des sorts de niveau 1 et 2 pour toute la partie.`); break;
      default: log('(sans effet)');
    }
  }

  /* ---------- Objets & transactions ---------- */
  function ochk(p, o, prm) {
    const owned = x => p.hand.includes(x);
    switch (o.key) {
      case 'gants': case 'philtre': case 'echange': case 'loupe': case 'edredon': case 'sablier': {
        const t = P(prm.player); if (!t || t === p) bad('Choisis un autre joueur.');
        if (['gants', 'philtre', 'echange', 'loupe'].includes(o.key) && t.lock) bad(`${t.name} est protégé : rien à lui prendre.`); break;
      }
      case 'aimant': if (!(prm.ing >= 0 && prm.ing < 16)) bad('Choisis un ingrédient.'); break;
      case 'transmut': if (!owned(prm.mine) || !isIng(prm.mine)) bad('Choisis un de tes ingrédients.'); if (!S.discard.includes((prm.disc || [])[0]) || !isIng(prm.disc[0])) bad('Choisis un ingrédient dans la défausse.'); break;
      case 'bongenie': if (!S.discard.includes((prm.disc || [])[0])) bad('Choisis une carte de la défausse.'); break;
      case 'boule': { const top = S.deck.slice(0, 5); if (!Array.isArray(prm.order) || prm.order.length !== top.length || !top.every(x => prm.order.includes(x))) bad('Ordre invalide.'); break; }
      case 'poubelle': if (!Array.isArray(prm.cards) || !prm.cards.every(owned)) bad('Cartes invalides.'); break;
      case 'chaudron': if (!Array.isArray(prm.cards) || prm.cards.length !== Math.min(2, p.hand.length) || !prm.cards.every(owned)) bad('Choisis 2 trouvailles.'); break;
      case 'bouclier': { const g = S.gages.find(g => g.i === prm.gi); if (!g || g.on !== p.id || D.spells[g.sid].level !== 1) bad('Aucun gage de niveau 1 sur toi.'); break; }
      case 'aspirateur': { const k = Math.min(2, S.discard.length); if (!Array.isArray(prm.disc) || prm.disc.length !== k || !prm.disc.every(x => S.discard.includes(x))) bad('Choisis 2 cartes dans la défausse.'); break; }
      case 'grimoire': if (!p.spells.includes(prm.mine)) bad('Choisis un de tes sortilèges.'); if (!S.piles[D.spells[prm.mine].level].length) bad('La pile de ce niveau est vide.'); break;
      case 'chapeau': if (!prm.sub || !p.spells.includes(prm.sub.sid)) bad('Choisis un sortilège de niveau 1.'); break;
    }
  }
  const LATE = new Set(['aspirateur', 'ramasse', 'bongenie', 'transmut']); // lisent la défausse : la carte jouée n'y entre qu'après
  function playObject(p, cid, prm) {
    const o = objOf(cid);
    if (NOPLAY.has(o.key)) bad(o.key === 'baguette' ? "La baguette s'utilise toute seule quand il manque un ingrédient." : o.key === 'cape' ? 'Se joue en réaction, quand un sort te vise.' : 'Se joue pendant les ventes aux enchères.');
    const late = LATE.has(o.key);
    if (!late) discardCards(p, [cid]);
    ochk(p, o, prm);
    log(`${o.emoji} ${p.name} joue « ${o.name} »`); fx('obj', { cid, by: p.id });
    const magic = !USELESS.has(o.key) && o.key !== 'puissance';
    const times = magic && p.double ? 2 : 1; if (times === 2) { p.double = 0; log('2️⃣ Puissance 2 : effet doublé !'); }
    for (let k = 0; k < times; k++) { try { if (k) ochk(p, o, prm); objEffect(p, o, prm); } catch (e) { if (!(e instanceof Err)) throw e; if (k === 0) throw e; } }
    if (late) discardCards(p, [cid]);
  }
  function objEffect(p, o, prm) {
    const t = prm.player ? P(prm.player) : null;
    switch (o.key) {
      case 'gants': steal(t, p, 1); break;
      case 'sifflet': S.reveal = p.id; log('🔔 Toutes les mains sont visibles jusqu\'à la fin du tour !'); break;
      case 'aimant': { let n = 0; ring(x => x !== p && !x.lock).forEach(x => { const k = x.hand.findIndex(c => isIng(c) && ingOf(c) === prm.ing); if (k >= 0) { p.hand.push(x.hand.splice(k, 1)[0]); n++; } }); log(`🧲 ${n} × ${D.ingredients[prm.ing].name} attirés !`); fx('boom'); break; }
      case 'cabas': draw(p, 3); log(`${p.name} pioche 3 trouvailles.`); break;
      case 'transmut': { p.hand.splice(p.hand.indexOf(prm.mine), 1); S.discard.push(prm.mine); const c = prm.disc[0]; S.discard.splice(S.discard.indexOf(c), 1); p.hand.push(c); log(`⚗️ ${p.name} transmute un ingrédient.`); break; }
      case 'echange': [p.hand, t.hand] = [t.hand, p.hand]; log(`🔀 ${p.name} échange sa main avec ${t.name} !`); fx('steal', { from: t.id, to: p.id, n: p.hand.length }); break;
      case 'bottes': S.extra += 1; log(`👢 ${p.name} jouera un tour de plus !`); break;
      case 'coffre': case 'parapluie': p.lock = 1; log(`🔒 ${p.name} est à l'abri jusqu'à son prochain tour.`); fx('lock', { id: p.id }); break;
      case 'grele': {
        const w = ring(x => x !== p && x.hand.length && !x.lock && !x.off).map(x => x.id);
        S.q.push({ k: 'multi', what: 'discard', wait: w, picks: {}, dl: now() + 45000 }); break;
      }
      case 'bongenie': { const c = prm.disc[0]; S.discard.splice(S.discard.indexOf(c), 1); p.hand.push(c); log(`🧞 ${p.name} récupère « ${cname(c)} » dans la défausse.`); break; }
      case 'philtre': S.q.push({ k: 'multi', what: 'give', wait: [t.id], picks: {}, to: p.id, n: 1, dl: now() + 40000 }); log(`💘 ${t.name} doit offrir une trouvaille à ${p.name}.`); break;
      case 'abonne': p.untarget = 1; log(`📵 ${p.name} est intouchable jusqu'à son prochain tour.`); break;
      case 'boule': { const n = prm.order.length; S.deck.splice(0, n, ...prm.order); log(`🔮 ${p.name} réorganise le haut de la pioche.`); break; }
      case 'edredon': t.skip = 1; log(`🛏️ ${t.name} passera son prochain tour.`); break;
      case 'ramasse': { const m = S.discard.splice(-3, 3); p.hand.push(...m); log(`🧹 ${p.name} ramasse ${m.length} carte(s) de la défausse.`); break; }
      case 'tapis': { const ps = ring(x => !x.lock && !x.off); const hs = ps.map(x => x.hand); ps.forEach((x, i) => { x.hand = hs[(i - 1 + ps.length) % ps.length]; }); log('🌀 Chaque joueur passe sa main à son voisin de gauche !'); fx('boom'); break; }
      case 'poubelle': { const n = prm.cards.length; discardCards(p, prm.cards); draw(p, n); log(`🗑️ ${p.name} change ${n} trouvaille(s).`); break; }
      case 'bouclier': S.gages = S.gages.filter(g => g.i !== prm.gi); log(`✨ ${p.name} se libère d'un gage !`); fx('shield', { id: p.id }); break;
      case 'puissance': p.double = 1; log(`2️⃣ ${p.name} doublera son prochain objet magique.`); break;
      case 'aspirateur': { const keep = prm.disc.slice(); keep.forEach(c => S.discard.splice(S.discard.indexOf(c), 1)); p.hand.push(...keep); S.deck.push(...S.discard); S.discard = []; log(`🌪️ ${p.name} aspire la défausse.`); fx('boom'); break; }
      case 'chaudron': { const n = prm.cards.length; discardCards(p, prm.cards); draw(p, 3); log(`🫕 ${p.name} défausse ${n} cartes et en pioche 3.`); break; }
      case 'chapeau': subCast(p, prm, { free: 1 }, true); break;
      case 'grimoire': { const s = prm.mine, lv = D.spells[s].level, n = S.piles[lv].pop(); p.spells.splice(p.spells.indexOf(s), 1, n); S.piles[lv].unshift(s); p.spells.sort((a, b) => D.spells[a].level - D.spells[b].level); log(`📖 ${p.name} change un sortilège de niveau ${lv}.`); break; }
      case 'sablier': t.timed = 1; log(`⏳ ${t.name} n'aura que 30 s à son prochain tour.`); break;
      case 'loupe': S.q.push({ k: 'take', who: p.id, from: t.id, n: 1, give: 1, ing: 1, dl: now() + 40000 }); break;
      default: { // objet inutile
        const jokes = ['Rien ne se passe… mais quelle classe.', 'Tout le monde te regarde bizarrement.', 'Ça ne sert à rien, et c\'est magnifique.', 'Le silence est assourdissant.'];
        log(`🤷 ${jokes[rand(jokes.length)]}`); fx('useless', { cid: 0, by: p.id });
      }
    }
  }
  function openTransaction(type, p) {
    const tr = D.transactions[type]; log(`${tr.emoji} ${p.name} ouvre : ${tr.name} !`); fx('trans', { t: type, by: p.id });
    if (S.taxe != null) {
      const tx = P(S.taxe), w = tx ? ring(x => x !== tx && x.hand.length && !x.lock && !x.off).map(x => x.id) : [];
      if (w.length) { log(`💸 Taxe : chacun verse une trouvaille à ${tx.name}.`); S.q.push({ k: 'multi', what: 'give', wait: w, picks: {}, to: tx.id, n: 1, dl: now() + 45000 }); }
    }
    if (type === 0) S.q.push({ k: 'multi', what: 'marche', wait: ring(x => x.hand.length && !x.lock && !x.off).map(x => x.id), picks: {}, dl: now() + 45000 });
    else if (type === 1) S.q.push({ k: 'multi', what: 'brocante', wait: ring(x => !x.lock && !x.off).map(x => x.id), picks: {}, dl: now() + 45000 });
    else {
      const order = []; let i = S.players.indexOf(p); for (let k = 0; k < S.players.length; k++) { order.push(S.players[i].id); i = nextIdx(i); }
      const cards = []; for (let k = 0; k < S.players.length; k++) { if (!S.deck.length && S.discard.length) { S.deck = shuffle(S.discard); S.discard = []; } if (S.deck.length) cards.push(S.deck.shift()); }
      S.q.push({ k: 'enchere', cards, order, i: 0, dl: now() + 30000 });
    }
  }

  /* ---------- Pending (réactions et choix collectifs) ---------- */
  function startPend(pd) {
    pd.id = ++S.pn;
    if (pd.k === 'multi') { // seuls restent ceux qui peuvent vraiment répondre (les mains ont pu changer entre-temps)
      pd.wait = pd.wait.filter(id => { const p = P(id); return p && !p.off && (pd.what === 'pass' ? p.spells.length : pd.what === 'brocante' ? true : p.hand.length); });
      if (pd.what === 'marche' && pd.wait.length < 2) return false;
      if (!pd.wait.length) return false;
    }
    if (pd.k === 'enchere' && !pd.cards.length) return false;
    S.pend = pd; return true;
  }
  function settle() {
    for (let g = 0; g < 60 && !S.pend && S.q.length; g++) startPend(S.q.shift());
    if (S.phase === 'play' && !S.pend) {
      const w = S.players.filter(p => !p.spells.length);
      if (w.length) {
        const cur = S.players[S.turn]; const win = w.includes(cur) ? [cur] : [w[0]];
        S.phase = 'end'; S.winner = win.map(p => p.id); log(`🏆 ${win[0].name} a lancé tous ses sortilèges et remporte la partie !`); fx('win', { id: win[0].id });
      }
    }
  }
  const done = () => { S.pend = null; };

  function answer(p, m) {
    const pd = S.pend; if (!pd) bad("Rien n'est en attente.");
    switch (pd.k) {
      case 'react': return ansReact(p, pd, m);
      case 'multi': return ansMulti(p, pd, m);
      case 'take': return ansTake(p, pd, m);
      case 'pickplayer': return ansPickPlayer(p, pd, m);
      case 'story': return ansStory(p, pd, m);
      case 'enchere': return ansEnchere(p, pd, m);
    }
  }
  function ansReact(p, pd, m) {
    if (pd.on !== p.id) bad("Ce n'est pas à toi de répondre.");
    const c = P(pd.by), sp = D.spells[pd.sid];
    switch (m.a) {
      case 'take': done(); log(`${p.name} encaisse.`); run(c, p, sp, pd.prm); break;
      case 'buy': {
        const k = Math.min(2, p.hand.length), cards = (m.cards || []).filter((x, i, a) => p.hand.includes(x) && a.indexOf(x) === i);
        if (cards.length !== k) bad(`Choisis ${k} trouvaille(s) à donner.`);
        done(); cards.forEach(x => { p.hand.splice(p.hand.indexOf(x), 1); c.hand.push(x); });
        log(`💸 ${p.name} se rachète : ${k} trouvaille(s) offerte(s) à ${c.name}. « ${sp.name} » est annulé.`); fx('buy', { from: p.id, to: c.id }); break;
      }
      case 'cape': {
        if (!p.hand.includes(CAPE)) bad("Tu n'as pas cette carte."); done(); discardCards(p, [CAPE]);
        log(`🧿 ${p.name} sort le Creuset de Mikaël : « ${sp.name} » est annulé !`); fx('shield', { id: p.id }); break;
      }
      case 'mirror': {
        if (!p.spells.includes(MIRROR.id)) bad("Tu n'as pas le sortilège Miroir.");
        if (p.silence) bad('Tu es réduit au silence !');
        const pay = payPlan(p, MIRROR.ing); if (!pay) bad('Il te manque des ingrédients pour le Miroir.');
        done(); for (const x of pay) { p.hand.splice(p.hand.indexOf(x), 1); S.discard.push(x); }
        p.spells.splice(p.spells.indexOf(MIRROR.id), 1); p.cast.push(MIRROR.id);
        fx('cast', { sid: MIRROR.id, by: p.id, on: c.id }); log(`🪞 ${p.name} lance « ${MIRROR.name} » : « ${sp.name} » se retourne contre ${c.name} !`);
        run(p, c, sp, pd.prm, { mirrored: 1 }); break;
      }
      default: bad('Réponse inconnue.');
    }
  }
  function ansMulti(p, pd, m) {
    if (!pd.wait.includes(p.id)) bad("Tu n'as rien à faire ici.");
    let pick;
    switch (pd.what) {
      case 'pass': if (!p.spells.includes(m.sid)) bad('Choisis un de tes sortilèges.'); pick = m.sid; break;
      case 'marche': case 'discard': if (!p.hand.includes((m.cards || [])[0])) bad('Choisis une trouvaille.'); pick = [m.cards[0]]; break;
      case 'brocante': { const c = (m.cards || []).filter((x, i, a) => p.hand.includes(x) && a.indexOf(x) === i); pick = c; break; }
      case 'give': { const n = Math.min(pd.n, p.hand.length), c = (m.cards || []).filter((x, i, a) => p.hand.includes(x) && a.indexOf(x) === i); if (c.length !== n) bad(`Choisis ${n} trouvaille(s).`); pick = c; break; }
    }
    pd.picks[p.id] = pick; pd.wait = pd.wait.filter(x => x !== p.id);
    if (!pd.wait.length) { done(); resolveMulti(pd); }
  }
  function resolveMulti(pd) {
    const ids = Object.keys(pd.picks), ps = S.players.filter(x => ids.includes(x.id));
    switch (pd.what) {
      case 'pass': {
        const out = ps.map(x => pd.picks[x.id]); ps.forEach(x => x.spells.splice(x.spells.indexOf(pd.picks[x.id]), 1));
        ps.forEach((x, i) => x.spells.push(out[(i - 1 + ps.length) % ps.length])); ps.forEach(x => x.spells.sort((a, b) => D.spells[a].level - D.spells[b].level));
        log('🎠 Les sortilèges tournent vers la gauche !'); fx('boom'); break;
      }
      case 'marche': {
        const out = ps.map(x => pd.picks[x.id][0]); ps.forEach(x => x.hand.splice(x.hand.indexOf(pd.picks[x.id][0]), 1));
        ps.forEach((x, i) => x.hand.push(out[(i - 1 + ps.length) % ps.length])); log('🏪 Les trouvailles changent de main !'); break;
      }
      case 'brocante': ps.forEach(x => { discardCards(x, pd.picks[x.id]); }); ps.forEach(x => { draw(x, pd.picks[x.id].length); }); log('🛒 La brocante est terminée.'); break;
      case 'give': { const to = P(pd.to); ps.forEach(x => { pd.picks[x.id].forEach(c => { x.hand.splice(x.hand.indexOf(c), 1); to.hand.push(c); }); }); log(`🎁 ${to.name} reçoit ${Object.values(pd.picks).reduce((a, b) => a + b.length, 0)} trouvaille(s).`); ps.forEach(x => fx('steal', { from: x.id, to: to.id, n: pd.picks[x.id].length })); break; }
      case 'discard': ps.forEach(x => { discardCards(x, pd.picks[x.id]); lumNote(x, 'défausse', pd.picks[x.id]); }); log('❄️ Chaque adversaire défausse une trouvaille.'); break;
    }
  }
  function ansTake(p, pd, m) {
    if (pd.who !== p.id) bad("Ce n'est pas à toi de choisir."); const f = P(pd.from);
    const cards = (m.cards || []).filter((x, i, a) => f.hand.includes(x) && a.indexOf(x) === i).slice(0, pd.n), want = Math.min(pd.n, f.hand.filter(x => !pd.ing || isIng(x)).length);
    if (cards.length !== want) bad(`Choisis ${want} carte(s).`); if (pd.ing && !cards.every(isIng)) bad('Un ingrédient seulement.');
    let giveBack = null; if (pd.give && cards.length && p.hand.length) { giveBack = (m.mine || []).find(x => p.hand.includes(x)); if (giveBack == null) bad('Choisis une de tes trouvailles à donner en échange.'); }
    done(); cards.forEach(x => { f.hand.splice(f.hand.indexOf(x), 1); p.hand.push(x); });
    if (giveBack != null) { p.hand.splice(p.hand.indexOf(giveBack), 1); f.hand.push(giveBack); }
    log(`${p.name} prend ${cards.length} carte(s) dans la main de ${f.name}${giveBack != null ? ' (en échange d\'une des siennes)' : ''}.`); if (cards.length) fx('steal', { from: f.id, to: p.id, n: cards.length });
  }
  function ansPickPlayer(p, pd, m) {
    if (pd.who !== p.id) bad("Ce n'est pas à toi de choisir."); const t = P(m.pl); if (!t || t === p) bad('Choisis un autre joueur.');
    done(); log(`💼 ${p.name} rackette ${t.name}.`); steal(t, p, 1);
  }
  function ansStory(p, pd, m) {
    if (pd.by !== p.id) bad('Seul le lanceur décide.'); const t = P(pd.on); done();
    if (m.ok) { log(`📖 ${t.name} a tenu 3 minutes sans s'arrêter ! Bravo.`); fx('cheer', { id: t.id }); }
    else { log(`😴 ${t.name} a craqué : 3 trouvailles pour ${p.name} !`); if (t.hand.length && !t.lock) S.q.push({ k: 'multi', what: 'give', wait: [t.id], picks: {}, to: p.id, n: Math.min(3, t.hand.length), dl: now() + 40000 }); }
  }
  function ansEnchere(p, pd, m) {
    if (m.pre) {
      if (!p.hand.includes(PREUM)) bad("Tu n'as pas Passe-droit."); if (pd.order[pd.i] === p.id) bad('Tu es déjà le prochain !');
      const at = pd.order.indexOf(p.id); if (at < pd.i) bad('Tu as déjà choisi.');
      discardCards(p, [PREUM]); pd.order.splice(at, 1); pd.order.splice(pd.i, 0, p.id); log(`⏩ ${p.name} grille la politesse avec Passe-droit !`); pd.dl = now() + 30000; return;
    }
    if (pd.order[pd.i] !== p.id) bad("Ce n'est pas encore ton tour de choisir.");
    const k = m.ci; if (!(k >= 0 && k < pd.cards.length) || pd.cards[k] == null) bad('Carte indisponible.');
    const c = pd.cards[k]; pd.cards[k] = null; p.hand.push(c); log(`🔨 ${p.name} remporte « ${cname(c)} ».`); pd.i++; pd.dl = now() + 30000;
    if (pd.i >= pd.order.length || !pd.cards.some(x => x != null)) { S.discard.push(...pd.cards.filter(x => x != null)); done(); }
  }

  /* ---------- Fautes et missions ---------- */
  function doFault(p, m) {
    const g = S.gages.find(x => x.i === m.gi); if (!g || g.by !== p.id) bad("Ce n'est pas ton gage.");
    const t = P(g.on === '*' ? m.who : g.on); if (!t || t === p) bad('Choisis le fautif.');
    log(`🚨 ${p.name} prend ${t.name} en faute !`); fx('fault', { id: t.id }); steal(t, p, 1);
  }
  function doDone(p, m) {
    const g = S.gages.find(x => x.i === m.gi); if (!g || g.by !== p.id) bad("Ce n'est pas ta mission.");
    S.gages = S.gages.filter(x => x !== g); log(`✅ « ${D.spells[g.sid].name} » est accompli.`);
  }

  /* ---------- Point d'entrée ---------- */
  function handle(p, m) {
    switch (m.t) {
      case 'pickSpell': return pickSpell(p, m.level);
      case 'autoSpells': return autoSpells(p);
      case 'cast': {
        mustTurn(p); const sp = D.spells[m.sid]; if (!sp || !p.spells.includes(sp.id)) bad("Ce sortilège n'est pas dans ta main.");
        return castSpell(p, sp, m.p || {}, {});
      }
      case 'play': {
        mustTurn(p); if (!p.hand.includes(m.cid)) bad("Tu n'as pas cette carte.");
        if (isObj(m.cid)) return playObject(p, m.cid, m.p || {});
        if (isTr(m.cid)) { discardCards(p, [m.cid]); return openTransaction(((m.cid - TR0) / 3) | 0, p); }
        bad("Les ingrédients servent à lancer des sortilèges.");
      }
      case 'end': mustTurn(p); return endTurn();
      case 'ans': return answer(p, m);
      case 'fault': return doFault(p, m);
      case 'done': return doDone(p, m);
      default: bad('Action inconnue.');
    }
  }
  function guarded(state, fn) {
    S = state; const snap = JSON.stringify(S);
    try { fn(); settle(); return { ok: true }; }
    catch (e) {
      if (!(e instanceof Err)) console.error(e);
      const o = JSON.parse(snap); for (const k in S) delete S[k]; Object.assign(S, o);
      return { err: e instanceof Err ? e.message : 'Erreur interne.' };
    }
  }
  function apply(state, pid, m) { return guarded(state, () => { const p = state.players.find(x => x.id === pid); if (!p) bad('Tu ne joues pas cette partie.'); handle(p, m || {}); }); }

  /* ---------- Horloge de l'hôte : délais, absents ---------- */
  function autoMsg(pd, p) {
    const h = p.hand, r = () => h[rand(h.length)];
    switch (pd.k) {
      case 'react': return { t: 'ans', a: 'take' };
      case 'multi': switch (pd.what) {
        case 'pass': return { t: 'ans', sid: p.spells[rand(p.spells.length)] };
        case 'brocante': return { t: 'ans', cards: [] };
        case 'give': return { t: 'ans', cards: shuffle(h.slice()).slice(0, pd.n) };
        default: return { t: 'ans', cards: [r()] };
      }
      case 'take': { const f = P(pd.from), pool = f.hand.filter(x => !pd.ing || isIng(x)); return { t: 'ans', cards: shuffle(pool.slice()).slice(0, pd.n), mine: pd.give ? [r()] : [] }; }
      case 'pickplayer': { const o = S.players.filter(x => x !== p && x.hand.length); return { t: 'ans', pl: (o[rand(o.length)] || S.players.find(x => x !== p)).id }; }
      case 'story': return { t: 'ans', ok: true };
      case 'enchere': return { t: 'ans', ci: pd.cards.findIndex(x => x != null) };
    }
  }
  function autoResolve(pd) {
    const who = pd.k === 'react' ? [pd.on] : pd.k === 'multi' ? pd.wait.slice() : pd.k === 'enchere' ? [pd.order[pd.i]] : [pd.who || pd.by];
    for (const id of who) { if (S.pend !== pd) break; const p = P(id); if (!p) continue; try { answer(p, autoMsg(pd, p)); } catch (e) { if (!(e instanceof Err)) throw e; if (S.pend === pd) { if (pd.k === 'react') { done(); } else if (pd.k === 'multi') { pd.wait = pd.wait.filter(x => x !== id); if (!pd.wait.length) { done(); resolveMulti(pd); } } else done(); } } }
  }
  function tick(state, t) {
    let changed = false;
    const r = guarded(state, () => {
      const pd = S.pend;
      if (S.phase === 'setup') { S.players.forEach(p => { if (p.off && !ready(p)) { autoSpells(p); changed = true; } }); }
      if (pd) {
        const waiting = pd.k === 'react' ? [pd.on] : pd.k === 'multi' ? pd.wait : pd.k === 'enchere' ? [pd.order[pd.i]] : [pd.who || pd.by];
        const onlyOff = waiting.length && waiting.every(id => { const p = P(id); return p && p.off; });
        if ((pd.dl && t > pd.dl) || onlyOff) { autoResolve(pd); changed = true; }
      } else if (S.phase === 'play') {
        const cp = S.players[S.turn];
        if (S.timer && t > S.timer.dl && S.timer.pid === cp.id) { log(`⏳ Temps écoulé pour ${cp.name} !`); endTurn(); changed = true; }
        else if (cp.off) { log(`⏭️ ${cp.name} est absent : son tour est sauté.`); endTurn(); changed = true; }
      }
    });
    return changed && !r.err;
  }
  function sync(state, offIds) {
    S = state; let ch = false;
    S.players.forEach(p => { const o = offIds.includes(p.id) ? 1 : 0; if (p.off !== o) { p.off = o; ch = true; } });
    return ch;
  }

  /* ---------- Aides pour l'interface ---------- */
  function canTarget(state, c, t, meta, level) {
    if (!t || t === c) return { ok: false };
    if (t.untarget && level != null) return { ok: false, why: '📵 intouchable' };
    if (t.wall && level != null && level <= 2) return { ok: false, why: '🧱 Mur de Vent' };
    if (meta && meta.steal && t.lock) return { ok: false, why: '🔒 protégé' };
    return { ok: true };
  }
  function canCast(state, p, sp, o) {
    o = o || {}; S = state;
    if (p.silence) return { ok: false, why: 'Silence : tu ne peux pas lancer de sort ce tour-ci' };
    if (META[sp.key].reactOnly) return { ok: false, why: 'Se lance en réaction, quand on te vise' };
    if (!o.free && !payPlan(p, sp.ing, o.minus)) return { ok: false, why: 'Ingrédients manquants' };
    if (sp.key === 'duplicata' && state.lastSpell == null) return { ok: false, why: 'Aucun sortilège à copier' };
    if (sp.key === 'transfert' && !state.gages.some(g => g.on === p.id && g.mode !== 'once')) return { ok: false, why: "Aucun gage sur toi" };
    if (sp.key === 'dommage' && !state.players.some(x => x !== p && x.cast.length)) return { ok: false, why: 'Aucun sortilège lancé' };
    if (['coupmaitre', 'elixir'].includes(sp.key) && p.spells.length < 2) return { ok: false, why: "Il te faut un autre sortilège" };
    return { ok: true };
  }
  function payFor(state, p, sp, o) { S = state; return payPlan(p, sp.ing, o && o.minus); }
  /* Après avoir payé `main`, reste-t-il de quoi lancer `sub` (avec un ingrédient en moins si minus) ? */
  function canSubAfter(state, p, main, sub, minus) {
    const pay = payPlan(p, main.ing, 0); if (!pay) return false;
    const hand = p.hand.slice(); pay.forEach(x => hand.splice(hand.indexOf(x), 1));
    return !!payPlan({ hand }, sub.ing, minus);
  }

  root.Engine = { newGame, apply, tick, sync, canTarget, canCast, payFor, canSubAfter, cardInfo, cname, META, OMETA, USELESS, NOPLAY, isIng, isObj, isTr, ingOf, spellSum, ready: (st, p) => { S = st; return ready(p); }, CAPE, PREUM, WAND, MIRROR };
})(typeof window !== 'undefined' ? window : globalThis);
