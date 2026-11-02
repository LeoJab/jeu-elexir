/* Élixir — réseau (salle du hub), état de partie, effets, démarrage. */
(function () {
  'use strict';
  const D = window.DATA, E = window.Engine, App = window.App;
  const $ = s => document.querySelector(s);
  const hub = !!window.ChadGang;
  let room = null, curGid = null, lastFx = 0, endShown = {}, finSent = {};
  const lastSeen = {};

  /* ---------- Salle locale de secours (hors hub : plusieurs onglets du même navigateur) ---------- */
  function localJoin(code, me) {
    const handlers = {}, ch = new BroadcastChannel('elixir-' + code), at = Date.now() + Math.random(), peers = new Map();
    peers.set(me.id, { id: me.id, name: me.name, at, seen: Date.now() });
    const emit = (ev, ...a) => (handlers[ev] || []).forEach(f => { try { f(...a); } catch (e) { console.error(e); } });
    const list = () => Array.from(peers.values()).sort((a, b) => a.at - b.at).map(p => ({ id: p.id, name: p.name }));
    const hello = () => ch.postMessage({ k: 'hello', id: me.id, name: me.name, at });
    ch.onmessage = ev => {
      const m = ev.data;
      if (m.k === 'hello') { const had = peers.has(m.id); peers.set(m.id, { id: m.id, name: m.name, at: m.at, seen: Date.now() }); if (!had) { hello(); emit('players', list()); } }
      else if (m.k === 'bye') { peers.delete(m.id); emit('players', list()); }
      else if (m.k === 'msg') emit('message', m.data, m.from);
    };
    const iv = setInterval(() => {
      hello(); let dirty = false;
      peers.forEach((p, id) => { if (id !== me.id && Date.now() - p.seen > 7000) { peers.delete(id); dirty = true; } });
      if (dirty) emit('players', list());
    }, 2000);
    setTimeout(() => { hello(); }, 50);
    setTimeout(() => {
      let last = null; try { if (peers.size > 1) last = JSON.parse(localStorage.getItem('elx-last-' + code)); } catch (e) { /* ignoré */ }
      emit('ready', { me: me.id, players: list(), last });
    }, 700);
    return {
      on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
      send(data, opts) {
        if (opts && opts.keep) { try { localStorage.setItem('elx-last-' + code, JSON.stringify(data)); } catch (e) { /* ignoré */ } }
        ch.postMessage({ k: 'msg', data, from: { id: me.id, name: me.name } });
        setTimeout(() => emit('message', data, { id: me.id, name: me.name }), 0);
      },
      leave() { ch.postMessage({ k: 'bye', id: me.id }); clearInterval(iv); ch.close(); }
    };
  }

  /* ---------- Envoi / réception ---------- */
  const send = (data, opts) => { if (room) room.send(data, opts); };
  const recomputeHost = () => { App.isHost = !!App.players.length && App.players[0].id === App.me.id; };
  function commit() {
    const S = App.S; S.v++;
    if (JSON.stringify(S).length > 11000) { S.log = S.log.slice(-8); S.fxq = S.fxq.slice(-3); }
    send({ t: 'state', s: S }, { keep: true });
    onState();
  }
  function processAct(pid, m) {
    const S = App.S; if (!S) return;
    const r = E.apply(S, pid, m);
    if (r.err) { if (pid === App.me.id) App.toast(r.err, 'err'); else send({ t: 'err', to: pid, msg: r.err }); return; }
    commit();
  }
  App.act = m => { if (!App.S) return; if (App.isHost) processAct(App.me.id, m); else send({ t: 'act', m }); };
  App.emote = e => send({ t: 'emo', e, from: App.me.id });
  App.startGame = target => {
    if (!App.isHost) return;
    if (App.players.length < 2) return App.toast('Il faut au moins 2 joueurs.', 'err');
    const v = (App.S ? App.S.v : 0) + 1;
    App.S = E.newGame(App.players, { gid: App.room + '-' + Date.now().toString(36), target: target || 9, v });
    App.closeModal(true); commit();
  };
  App.leave = () => {
    if (room) { try { room.leave(); } catch (e) { /* ignoré */ } }
    room = null; App.S = null; App.players = []; curGid = null; App.cancelPrompt(); App.show('home');
  };
  function onMessage(d, from) {
    if (!d) return;
    if (d.t === 'state') receiveState(d.s);
    else if (d.t === 'act') { if (App.isHost && App.S) processAct(from.id, d.m); }
    else if (d.t === 'err') { if (d.to === App.me.id) App.toast(d.msg, 'err'); }
    else if (d.t === 'emo') { const p = pos(d.from); FX.floatText(d.e, p.x, p.y); Sfx.play('emo'); }
  }
  function receiveState(s) {
    if (!s || (App.S && s.v <= App.S.v)) return;
    App.S = s; onState();
  }

  /* ---------- Réaction à un nouvel état ---------- */
  const nm = id => { const p = App.S.players.find(x => x.id === id); return p ? p.name : '?'; };
  function pos(id) {
    const c = id && id !== App.me.id ? App.centerOfPlayer(id) : null;
    return c && c.x ? c : { x: innerWidth / 2, y: innerHeight - 90 };
  }
  function onState() {
    const S = App.S; if (!S) return;
    if (S.gid !== curGid) { curGid = S.gid; lastFx = S.phase === 'setup' ? 0 : S.fxn; App.resetSel(); App.cancelPrompt(); if (S.phase !== 'end') App.closeModal(true); }
    App.render();
    const evs = S.fxq.filter(e => e.i > lastFx); lastFx = S.fxn;
    let delay = 0;
    evs.forEach(e => { const d = e.k === 'cast' ? delay : 0; if (e.k === 'cast') delay += 1100; setTimeout(() => { try { playFx(e); } catch (err) { console.error(err); } }, d); });
    if (S.phase === 'end' && !endShown[S.gid]) {
      endShown[S.gid] = 1; setTimeout(() => { if (App.S && App.S.phase === 'end') App.showEnd(); }, 1800);
      const me = App.S.players.find(p => p.id === App.me.id);
      if (me && !finSent[S.gid] && window.ChadGang && ChadGang.finPartie) {
        finSent[S.gid] = 1;
        try { ChadGang.finPartie({ gagne: S.winner.includes(me.id), partie: String(S.gid).slice(0, 64) }).catch(() => {}); } catch (err) { /* ignoré */ }
      }
    }
  }
  function playFx(e) {
    const me = App.me, S = App.S; if (!S) return;
    switch (e.k) {
      case 'cast': {
        const sp = D.spells[e.sid];
        FX.cinematic({ sp, by: nm(e.by), on: e.on ? nm(e.on) : '', esc: App.esc });
        if (e.on === me.id) setTimeout(() => { FX.flash('#ff4d6d', 500); FX.shake(sp.level >= 3); Sfx.play('hit'); }, 350);
        if (e.on) { const el = document.querySelector(`[data-pid="${CSS.escape(e.on)}"]`); if (el) { el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 600); } }
        break;
      }
      case 'turn': if (e.id === me.id) { Sfx.play('turn'); App.toast('🎯 À toi de jouer !', 'big'); } break;
      case 'steal': { const a = pos(e.from), b = pos(e.to); FX.burst(a.x, a.y, { n: 12, emoji: ['🃏'], speed: 220 }); FX.floatText('-' + e.n + ' 🃏', a.x, a.y, '#ff9aa8'); setTimeout(() => { FX.burst(b.x, b.y, { n: 8, emoji: ['🃏', '✨'], speed: 160 }); FX.floatText('+' + e.n + ' 🃏', b.x, b.y, '#9affb4'); }, 350); Sfx.play(e.from === me.id ? 'hit' : 'draw'); break; }
      case 'lock': case 'shield': { const p = pos(e.id); FX.burst(p.x, p.y, { n: 16, emoji: [e.k === 'lock' ? '🔒' : '🛡️', '✨'], speed: 200 }); Sfx.play('shield'); break; }
      case 'boom': FX.flash('#fff', 500); FX.shake(false); Sfx.play('boom'); break;
      case 'reverse': FX.floatText('↩️ Sens inversé !', innerWidth / 2, innerHeight / 2); FX.shake(false); Sfx.play('boom'); break;
      case 'skip': { const p = pos(e.id); FX.floatText('⏭️ Passe !', p.x, p.y); break; }
      case 'win': FX.confetti(220); FX.fireworks(8); Sfx.play('win'); break;
      case 'obj': { const o = D.objects[e.cid - 64]; FX.burst(innerWidth / 2, innerHeight / 2, { n: 14, emoji: [o ? o.emoji : '✨', '✨'], speed: 260 }); Sfx.play('click'); break; }
      case 'useless': FX.burst(innerWidth / 2, innerHeight / 2, { n: 8, emoji: ['🤷'], speed: 160 }); break;
      case 'trans': App.toast(`${D.transactions[e.t].emoji} ${nm(e.by)} : ${D.transactions[e.t].name} !`, 'big'); Sfx.play('draw'); break;
      case 'fault': { const p = pos(e.id); FX.floatText('🚨 FAUTE !', p.x, p.y, '#ff4d6d'); if (e.id === App.me.id) { FX.flash('#ff4d6d', 400); } Sfx.play('hit'); break; }
      case 'buy': { const a = pos(e.from); FX.burst(a.x, a.y, { n: 14, emoji: ['💸'], speed: 240 }); Sfx.play('draw'); break; }
      case 'cheer': { const p = pos(e.id); FX.burst(p.x, p.y, { n: 18, emoji: ['🎉', '👏'], speed: 260 }); break; }
    }
  }

  /* ---------- Connexion à une salle ---------- */
  function connect(code, create) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (code.length < 3) return App.toast('Code de salle invalide.', 'err');
    if (!hub) { App.me.name = ($('#pseudo').value || '').trim().slice(0, 18) || App.me.name || 'Sorcier' + Math.floor(Math.random() * 90 + 10); try { localStorage.setItem('elx-name', App.me.name); } catch (e) { /* ignoré */ } }
    App.room = code; App.S = null; App.players = [];
    room = hub ? ChadGang.join(code, { create: !!create }) : localJoin(code, App.me);
    room.on('ready', info => {
      App.players = info.players || []; recomputeHost();
      if (info.last && info.last.t === 'state') receiveState(info.last.s);
      App.render();
    });
    room.on('players', list => { App.players = list || []; recomputeHost(); App.render(); });
    room.on('message', onMessage);
    room.on('error', msg => { App.toast(String(msg || 'Salle introuvable.'), 'err'); App.leave(); });
    App.render();
  }
  const randomCode = () => { const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let c = ''; for (let i = 0; i < 4; i++) c += L[Math.floor(Math.random() * L.length)]; return c; };

  /* ---------- Horloge de l'hôte : délais, absents ---------- */
  setInterval(() => {
    const S = App.S; if (!App.isHost || !S || S.phase === 'end') return;
    const ids = new Set(App.players.map(p => p.id)), now = Date.now(), off = [];
    S.players.forEach(p => { if (ids.has(p.id) || !(p.id in lastSeen)) lastSeen[p.id] = ids.has(p.id) ? now : (lastSeen[p.id] || now); else if (now - lastSeen[p.id] > 8000) off.push(p.id); });
    let ch = E.sync(S, off); if (E.tick(S, now)) ch = true;
    if (ch) commit();
  }, 1000);

  /* ---------- Démarrage ---------- */
  async function boot() {
    let me = null;
    if (hub) { try { me = await ChadGang.me(); } catch (e) { /* ignoré */ } }
    if (!me) {
      let id = null; try { id = sessionStorage.getItem('elx-id'); } catch (e) { /* ignoré */ }
      if (!id) { id = 'L' + Math.random().toString(36).slice(2, 8); try { sessionStorage.setItem('elx-id', id); } catch (e) { /* ignoré */ } }
      let name = ''; try { name = localStorage.getItem('elx-name') || ''; } catch (e) { /* ignoré */ }
      me = { id, name, avatar: null, local: true };
    }
    App.me = me;
    if (!hub || !me.name) { $('#pseudo-row').classList.remove('hidden'); $('#pseudo').value = me.name || ''; }
    $('#b-create').onclick = () => connect(randomCode(), true);
    $('#b-join').onclick = () => connect($('#code').value, false);
    $('#code').addEventListener('keydown', e => { if (e.key === 'Enter') connect($('#code').value, false); });
    $('#b-rules0').onclick = () => App.showRules();
    const inv = hub ? ChadGang.room() : new URLSearchParams(location.search).get('room');
    if (inv) connect(inv, !hub);
    else App.show('home');
  }
  boot();
})();
