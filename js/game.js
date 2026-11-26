/* Battleship Live: game logic and UI. */
(() => {
  'use strict';

  // ---------- constants ----------
  const SIZE = 10, ROWS = 'ABCDEFGHIJ';
  const FLEET = [
    { id: 'carrier', name: 'Carrier', size: 5 },
    { id: 'battleship', name: 'Battleship', size: 4 },
    { id: 'cruiser', name: 'Cruiser', size: 3 },
    { id: 'submarine', name: 'Submarine', size: 3 },
    { id: 'destroyer', name: 'Destroyer', size: 2 },
  ];
  const SHIP = Object.fromEntries(FLEET.map(s => [s.id, s]));
  const qs = new URLSearchParams(location.search);
  const SPEED = Math.min(1, Math.max(0.05, parseFloat(qs.get('speed')) || 1)); // ?speed=0.2 for testing
  const FLIGHT = Math.round(1150 * SPEED);
  const SETTLE = Math.round(700 * SPEED);
  const SETTLE_SUNK = Math.round(1500 * SPEED);
  const VERSION = 1;
  const TOUCH = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches); // phones and tablets
  const stacked = () => !!(window.matchMedia && matchMedia('(max-width: 760px)').matches); // boards stacked vertically
  const K = { name: 'bslive:name', game: 'bslive:game:', alive: 'bslive:alive:', tab: 'bslive:tab:' };
  const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  // ---------- helpers ----------
  const $ = id => document.getElementById(id);
  const now = () => Date.now();
  const other = role => (role === 'host' ? 'guest' : 'host');
  const coord = (r, c) => ROWS[r] + (c + 1);
  const inBounds = (r, c) => Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  const randStr = (n, alpha = CODE_ALPHA) => { const a = new Uint32Array(n); crypto.getRandomValues(a); return Array.from(a, x => alpha[x % alpha.length]).join(''); };
  const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 16);
  const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const validCode = c => typeof c === 'string' && c.length === 6 && [...c].every(ch => CODE_ALPHA.includes(ch));

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full or blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const sess = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };
  const aliveAt = (code, role) => +(store.get(K.alive + code + ':' + role) || 0);

  // ---------- ship geometry ----------
  function cellsOf(s) {
    const n = SHIP[s.id].size, out = [];
    for (let i = 0; i < n; i++) out.push(s.dir === 'h' ? [s.r, s.c + i] : [s.r + i, s.c]);
    return out;
  }
  function fits(id, r, c, dir, ships) {
    const n = SHIP[id].size;
    if (!inBounds(r, c) || (dir === 'h' ? c + n > SIZE : r + n > SIZE)) return false;
    const taken = new Set();
    ships.forEach(s => { if (s.id !== id) cellsOf(s).forEach(([a, b]) => taken.add(a * SIZE + b)); });
    for (let i = 0; i < n; i++) {
      const rr = dir === 'h' ? r : r + i, cc = dir === 'h' ? c + i : c;
      if (taken.has(rr * SIZE + cc)) return false;
    }
    return true;
  }
  function randomFleet(keep = []) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const ships = keep.slice();
      let ok = true;
      for (const f of FLEET) {
        if (ships.some(s => s.id === f.id)) continue;
        let placed = false;
        for (let k = 0; k < 400 && !placed; k++) {
          const dir = Math.random() < 0.5 ? 'h' : 'v';
          const r = Math.floor(Math.random() * SIZE), c = Math.floor(Math.random() * SIZE);
          if (fits(f.id, r, c, dir, ships)) { ships.push({ id: f.id, r, c, dir }); placed = true; }
        }
        if (!placed) { ok = false; break; }
      }
      if (ok) return ships;
    }
    return keep.slice();
  }
  function validFleet(ships) {
    if (!Array.isArray(ships) || ships.length !== FLEET.length) return false;
    const acc = [];
    for (const s of ships) {
      if (!s || !SHIP[s.id] || (s.dir !== 'h' && s.dir !== 'v') || acc.some(a => a.id === s.id) || !fits(s.id, s.r, s.c, s.dir, acc)) return false;
      acc.push({ id: s.id, r: s.r, c: s.c, dir: s.dir });
    }
    return true;
  }
  function shipFromCells(id, cells) {
    const r = Math.min(...cells.map(x => x[0])), c = Math.min(...cells.map(x => x[1]));
    return { id, r, c, dir: cells.every(x => x[0] === cells[0][0]) ? 'h' : 'v' };
  }

  // ---------- ship artwork (top-down SVG) ----------
  function shipArt(id) {
    const W = SHIP[id].size * 100;
    const hull = `<path class="hull" d="M12 50 C12 30 22 18 44 18 L${W - 110} 18 C${W - 50} 18 ${W - 14} 34 ${W - 4} 50 C${W - 14} 66 ${W - 50} 82 ${W - 110} 82 L44 82 C22 82 12 70 12 50 Z"/>`;
    const deck = `<path class="deck" d="M26 50 C26 36 32 30 48 30 L${W - 120} 30 C${W - 70} 30 ${W - 34} 40 ${W - 22} 50 C${W - 34} 60 ${W - 70} 70 ${W - 120} 70 L48 70 C32 70 26 64 26 50 Z"/>`;
    const turret = (x, dir) => {
      const bx = dir > 0 ? x : x - 32;
      return `<rect class="dark" x="${bx}" y="43" width="32" height="4" rx="2"/><rect class="dark" x="${bx}" y="53" width="32" height="4" rx="2"/><circle class="detail" cx="${x}" cy="50" r="14"/><circle class="dark" cx="${x}" cy="50" r="6"/>`;
    };
    const bridge = (x, w) => `<rect class="detail" x="${x}" y="35" width="${w}" height="30" rx="6"/><rect class="dark" x="${x + w * 0.3}" y="43" width="${w * 0.4}" height="14" rx="3"/>`;
    switch (id) {
      case 'carrier':
        return `<path class="hull" d="M10 22 L${W - 100} 22 C${W - 50} 22 ${W - 16} 36 ${W - 6} 50 C${W - 16} 64 ${W - 50} 78 ${W - 100} 78 L10 78 Q6 78 6 72 L6 28 Q6 22 10 22 Z"/>
          <line class="runway" x1="30" y1="54" x2="${W - 70}" y2="54"/>
          <line class="runway" x1="40" y1="68" x2="${W * 0.55}" y2="34"/>
          <rect class="detail" x="${W - 210}" y="24" width="70" height="16" rx="3"/><rect class="dark" x="${W - 190}" y="27" width="22" height="10" rx="2"/>
          <path class="detail" d="M80 34 L104 42 L80 50 Z"/><path class="detail" d="M150 58 L174 66 L150 74 Z"/><path class="detail" d="M220 40 L244 48 L220 56 Z"/>`;
      case 'battleship':
        return hull + deck + turret(85, -1) + turret(130, -1) + bridge(165, 70) + turret(270, 1) + turret(318, 1);
      case 'cruiser':
        return hull + deck + turret(75, -1) + bridge(112, 56) + turret(212, 1);
      case 'submarine':
        return `<path class="hull" d="M10 50 C10 36 30 30 60 30 L${W - 70} 30 C${W - 30} 30 ${W - 8} 42 ${W - 4} 50 C${W - 8} 58 ${W - 30} 70 ${W - 70} 70 L60 70 C30 70 10 64 10 50 Z"/>
          <rect class="dark" x="2" y="46" width="16" height="8" rx="2"/>
          <rect class="detail" x="118" y="39" width="64" height="22" rx="11"/><circle class="dark" cx="160" cy="50" r="4"/>
          <line class="runway" x1="40" y1="50" x2="100" y2="50" style="stroke-dasharray:4 8;opacity:.35"/>`;
      default: // destroyer
        return hull + deck + bridge(52, 44) + turret(140, 1);
    }
  }
  function shipSVG(id, dir) {
    const W = SHIP[id].size * 100;
    const art = shipArt(id);
    return dir === 'h'
      ? `<svg viewBox="0 0 ${W} 100" preserveAspectRatio="none">${art}</svg>`
      : `<svg viewBox="0 0 100 ${W}" preserveAspectRatio="none"><g transform="translate(100,0) rotate(90)">${art}</g></svg>`;
  }
  function shipEl(s, cls = '') {
    const n = SHIP[s.id].size;
    const d = document.createElement('div');
    d.className = 'ship ' + cls;
    d.style.left = s.c * 10 + '%';
    d.style.top = s.r * 10 + '%';
    d.style.width = (s.dir === 'h' ? n : 1) * 10 + '%';
    d.style.height = (s.dir === 'v' ? n : 1) * 10 + '%';
    d.innerHTML = shipSVG(s.id, s.dir);
    return d;
  }

  // ---------- state ----------
  let S = null;      // persistent game state (saved to localStorage)
  let net = null;
  const ui = {
    screen: null, boards: {}, sel: null, dir: 'h', hover: null,
    holds: new Map(), busyUntil: 0, busyLabel: '',
    overDismissed: 0, conn: 'idle', connKind: null, wasLost: false,
    lastIn: null, lastOut: null, fireRetry: 0, toastT: 0, lastSyncReq: 0,
  };

  function newState(code, role, name) {
    return {
      v: VERSION, code, role, myName: name, oppName: '',
      token: role === 'guest' ? randStr(16, 'abcdefghijkmnpqrstuvwxyz23456789') : null, guestToken: null,
      round: 1, phase: 'place', ships: [], ready: false, oppReady: false, first: null,
      received: [], fired: [], pending: null, oppShips: null, rematch: { me: false, opp: false },
      score: { host: 0, guest: 0 }, lastWinner: null, scoredRound: 0, celebrated: 0,
      log: [], created: now(), savedAt: now(),
    };
  }
  function save() { if (!S) return; S.savedAt = now(); store.set(K.game + S.code + ':' + S.role, S); }

  const oppName = () => S.oppName || 'Opponent';
  const hitSetOf = list => new Set(list.filter(x => x.res !== 'miss').map(x => x.r * SIZE + x.c));
  const shipAt = (r, c) => S.ships.find(s => cellsOf(s).some(([a, b]) => a === r && b === c)) || null;
  const isSunk = (s, hits) => cellsOf(s).every(([a, b]) => hits.has(a * SIZE + b));
  function allMineSunk() {
    if (S.ships.length !== FLEET.length) return false;
    const h = hitSetOf(S.received);
    return S.ships.every(s => isSunk(s, h));
  }
  const enemySunkIds = (list = S.fired) => new Set(list.filter(x => x.res === 'sunk' && x.ship).map(x => x.ship));
  function myTurn() {
    if (!S || S.phase !== 'battle' || !S.first) return false;
    return S.first === S.role ? S.fired.length === S.received.length : S.received.length > S.fired.length;
  }
  const busy = () => now() < ui.busyUntil;
  const canFire = () => !!S && S.phase === 'battle' && myTurn() && !S.pending && !!net && net.connected && !busy();

  function publicShot(x) {
    const o = { r: x.r, c: x.c, res: x.res };
    if (x.res === 'sunk') {
      const s = S.ships.find(y => y.id === x.ship);
      o.ship = x.ship; o.cells = s ? cellsOf(s) : [];
    }
    return o;
  }
  function cleanShot(x) {
    if (!x || !inBounds(x.r, x.c) || !['miss', 'hit', 'sunk'].includes(x.res)) return null;
    const o = { r: x.r, c: x.c, res: x.res };
    if (x.res === 'sunk') {
      if (!SHIP[x.ship] || !Array.isArray(x.cells) || x.cells.length !== SHIP[x.ship].size) return null;
      if (!x.cells.every(p => Array.isArray(p) && inBounds(p[0], p[1]))) return null;
      o.ship = x.ship; o.cells = x.cells.map(p => [p[0], p[1]]);
    }
    return o;
  }
  function mySync() {
    return {
      name: S.myName, round: S.round, phase: S.phase, ready: S.ready, first: S.first,
      received: S.received.map(publicShot),
      score: S.score, lastWinner: S.lastWinner, scoredRound: S.scoredRound,
      rematch: S.rematch.me, reveal: S.phase === 'over' ? S.ships : null,
    };
  }

  // ---------- network message handling ----------
  function applySync(o) {
    if (!o || typeof o !== 'object') return;
    if (o.name) S.oppName = cleanName(o.name) || 'Opponent';
    if (S.role === 'guest' && Number.isFinite(o.scoredRound) && o.scoredRound >= S.scoredRound && o.score) {
      S.score = { host: o.score.host | 0, guest: o.score.guest | 0 };
      S.scoredRound = o.scoredRound;
      if (o.lastWinner === 'host' || o.lastWinner === 'guest' || o.lastWinner === null) S.lastWinner = o.lastWinner;
    }
    if (!Number.isFinite(o.round)) return;
    if (o.round > S.round) newRound(o.round);
    if (o.round !== S.round) return;
    S.oppReady = !!o.ready;
    if (Array.isArray(o.received)) {
      const mirror = [];
      for (const x of o.received) { const s = cleanShot(x); if (!s) break; mirror.push(s); }
      S.fired = mirror;
      if (S.pending && (S.fired.length > S.pending.n || now() - S.pending.at > 3000)) { S.pending = null; clearTimeout(ui.fireRetry); }
    }
    if (S.role === 'guest' && S.phase === 'place' && (o.first === 'host' || o.first === 'guest') && (o.phase === 'battle' || o.phase === 'over')) {
      beginBattle(o.first, true);
    }
    if (o.reveal && validFleet(o.reveal)) S.oppShips = o.reveal;
    checkOver();
    if (S.phase === 'over') {
      S.rematch.opp = !!o.rematch && o.phase === 'over';
      maybeNewRound();
    }
    save();
  }

  function requestSync() {
    if (!net || now() - ui.lastSyncReq < 800) return;
    ui.lastSyncReq = now();
    net.send({ t: 'sync', sync: mySync(), want: true });
  }

  function onMessage(m, ch) {
    if (!S) return;
    if (S.role === 'host') {
      if (m.t === 'hello') { onHello(m, ch); return; }
      if (!m.tk || m.tk !== S.guestToken) return;
    }
    switch (m.t) {
      case 'welcome': onWelcome(m); break;
      case 'full':
        showMsg('This game is full', 'Two captains are already playing this game. Ask your friend for a new invite link, or start your own game.');
        net.destroy();
        break;
      case 'sync':
        applySync(m.sync);
        if (m.want) net.send({ t: 'sync', sync: mySync() });
        maybeStart(); render();
        break;
      case 'ready':
        if (m.round === S.round && S.phase === 'place') {
          const was = S.oppReady;
          S.oppReady = !!m.v;
          if (S.oppReady && !was) { addLog('sys', `${oppName()} is ready for battle.`); Sound.tick(); }
          save(); maybeStart(); render();
        }
        break;
      case 'start':
        if (S.role !== 'guest') break;
        if (m.round !== S.round) { requestSync(); break; }
        if (S.phase === 'place' && (m.first === 'host' || m.first === 'guest')) beginBattle(m.first);
        break;
      case 'fire': onFire(m); break;
      case 'result': onResult(m); break;
      case 'reveal':
        if (m.round === S.round && validFleet(m.ships)) { S.oppShips = m.ships; save(); render(); }
        break;
      case 'rematch':
        if (m.round === S.round && S.phase === 'over' && !S.rematch.opp) {
          S.rematch.opp = true;
          addLog('sys', `${oppName()} wants a rematch.`);
          Sound.tick();
          maybeNewRound(); save(); render();
        }
        break;
      case 'chat':
        if (typeof m.text === 'string' && m.text.trim()) { addLog('chat', m.text.trim().slice(0, 200), oppName()); Sound.blip(); }
        break;
    }
  }

  function onHello(m, ch) {
    if (!m.tk || typeof m.tk !== 'string') return;
    const fresh = S.round === 1 && S.phase === 'place' && !S.received.length && !S.fired.length;
    if (S.guestToken && S.guestToken !== m.tk && !(fresh && !net.isLive())) { net.sendVia(ch, { t: 'full' }); return; }
    const newGuest = S.guestToken !== m.tk;
    if (newGuest && S.guestToken) { S.oppReady = false; S.oppName = ''; }
    S.guestToken = m.tk;
    net.adopt(ch, m.tk);
    applySync(m.sync);
    net.send({ t: 'welcome', sync: mySync() });
    if (newGuest) { addLog('sys', `${oppName()} joined the game.`); Sound.join(); toast(`${oppName()} joined your game!`); }
    save(); maybeStart(); render();
  }

  function onWelcome(m) {
    const firstTime = !S.oppName;
    applySync(m.sync);
    if (firstTime) { addLog('sys', `You joined ${oppName()}'s game.`); Sound.join(); }
    save(); render();
  }

  function onStatus(st, kind) {
    const prev = ui.conn;
    ui.conn = st; ui.connKind = kind;
    if (S) {
      if (st === 'connected' && ui.wasLost) {
        ui.wasLost = false;
        addLog('sys', S.role === 'host' ? `${oppName()} reconnected.` : 'Reconnected.');
      }
      if ((st === 'opp-offline' || st === 'reconnecting') && prev === 'connected') {
        ui.wasLost = true;
        addLog('sys', S.role === 'host' ? `${oppName()} disconnected. Waiting for them to come back…` : 'Lost connection to the host. Reconnecting…');
      }
    }
    render();
  }

  function onFatal(kind) {
    if (kind === 'taken') showMsg('Game already open', 'This game is already open in another tab or window. Close the other one, or start a new game.');
  }

  // ---------- game flow ----------
  function maybeStart() {
    if (!S || S.role !== 'host' || S.phase !== 'place' || !S.ready || !S.oppReady || !net || !net.connected) return;
    const first = S.lastWinner ? other(S.lastWinner) : (Math.random() < 0.5 ? 'host' : 'guest');
    net.send({ t: 'start', first, round: S.round });
    beginBattle(first);
  }

  function beginBattle(first, quiet) {
    if (S.ships.length !== FLEET.length) S.ships = randomFleet(S.ships);
    S.ready = true; S.first = first; S.phase = 'battle'; S.pending = null;
    ui.sel = null; ui.hover = null;
    addLog('sys', `Battle stations! ${first === S.role ? 'You fire' : oppName() + ' fires'} first.`);
    if (!quiet) {
      Sound.start();
      setBusy(Math.round(1400 * SPEED), 'Battle stations!');
      setTimeout(() => { if (myTurn()) Sound.ping(); }, Math.round(1500 * SPEED));
    }
    save();
    show('battle');
    window.scrollTo(0, 0);
  }

  function onTargetClick(r, c) {
    if (!S || S.phase !== 'battle') return;
    if (S.fired.some(x => x.r === r && x.c === c)) { Sound.error(); return; }
    if (!canFire()) {
      if (!net.connected) toast('Waiting for the connection to come back.');
      else if (!myTurn() && !busy()) toast(`It's ${oppName()}'s turn.`);
      if (!busy()) Sound.error();
      return;
    }
    const n = S.fired.length;
    S.pending = { r, c, n, at: now() };
    ui.lastOut = r * SIZE + c;
    setBusy(FLIGHT + 200, 'Missile away…');
    Sound.launch();
    flyMissile(ui.boards.own.sea, ui.boards.target, r, c, FLIGHT);
    net.send({ t: 'fire', r, c, n, round: S.round });
    armFireRetry();
    save(); render();
  }

  function armFireRetry() {
    clearTimeout(ui.fireRetry);
    ui.fireRetry = setTimeout(() => {
      if (S && S.pending && net.connected) {
        net.send({ t: 'fire', r: S.pending.r, c: S.pending.c, n: S.pending.n, round: S.round });
        armFireRetry();
      }
    }, 5000);
  }

  // Defender side: my computer decides whether the shot hit my fleet.
  function onFire(m) {
    if (m.round !== S.round) { if (m.round > S.round) requestSync(); return; }
    const n = m.n;
    if (!Number.isInteger(n)) return;
    if (n < S.received.length) { resendResult(n); return; }
    if (S.phase !== 'battle' || n !== S.received.length || myTurn()) { requestSync(); return; }
    const r = m.r, c = m.c;
    if (!inBounds(r, c) || S.received.some(x => x.r === r && x.c === c)) { requestSync(); return; }
    const ship = shipAt(r, c);
    let res = 'miss';
    if (ship) { const hits = hitSetOf(S.received); hits.add(r * SIZE + c); res = isSunk(ship, hits) ? 'sunk' : 'hit'; }
    const entry = { r, c, res };
    if (ship) entry.ship = ship.id;
    S.received.push(entry);
    net.send({ t: 'result', n, round: S.round, shot: publicShot(entry) });

    const settle = res === 'sunk' ? SETTLE_SUNK : SETTLE;
    ui.lastIn = r * SIZE + c;
    hold('o', r, c, FLIGHT);
    setBusy(FLIGHT + settle, 'Incoming fire!');
    Sound.whistle();
    // On a phone the boards are stacked: bring my fleet into view, then let the missile fly in.
    const lead = stacked() ? Math.round(Math.min(400, FLIGHT / 3)) : 0;
    if (lead) focusBoard('own');
    setTimeout(() => flyMissile(ui.boards.target.sea, ui.boards.own, r, c, FLIGHT - lead), lead);
    setTimeout(() => {
      impactFx(ui.boards.own, r, c, res);
      const at = coord(r, c), nm = ship ? SHIP[ship.id].name : '';
      if (res === 'miss') { Sound.splash(); ui.busyLabel = `${oppName()} missed.`; addLog('opp', `${oppName()} fired at ${at}: miss.`); }
      else if (res === 'hit') { Sound.boom(); ui.busyLabel = `Your ${nm} was hit!`; addLog('opp-hit', `${oppName()} fired at ${at}: hit your ${nm}!`); }
      else { Sound.sunk(); ui.busyLabel = `Your ${nm} was sunk!`; addLog('opp-sunk', `${oppName()} fired at ${at} and sank your ${nm}!`); }
      render();
    }, FLIGHT);
    setTimeout(() => {
      if (!myTurn()) return;
      Sound.ping();
      setTimeout(() => focusBoard('target'), Math.round(450 * SPEED));
    }, FLIGHT + settle + 40);
    checkOver(); save(); render();
  }

  function resendResult(n) {
    const e = S.received[n];
    if (e) net.send({ t: 'result', n, round: S.round, shot: publicShot(e) });
  }

  // Attacker side: the defender told me what my missile did.
  function onResult(m) {
    if (m.round !== S.round || S.phase === 'place') return;
    const shot = cleanShot(m.shot);
    if (!shot || m.n !== S.fired.length) { if (m.n > S.fired.length) requestSync(); return; }
    if (S.fired.some(x => x.r === shot.r && x.c === shot.c)) { requestSync(); return; }
    S.fired.push(shot);
    const launched = S.pending && S.pending.n === m.n ? S.pending.at : 0;
    S.pending = null; clearTimeout(ui.fireRetry);
    const delay = launched ? Math.max(0, launched + FLIGHT - now()) : 0;
    const settle = shot.res === 'sunk' ? SETTLE_SUNK : SETTLE;
    hold('t', shot.r, shot.c, delay);
    ui.lastOut = shot.r * SIZE + shot.c;
    setBusy(delay + settle, ui.busyLabel || 'Missile away…');
    setTimeout(() => {
      impactFx(ui.boards.target, shot.r, shot.c, shot.res);
      const at = coord(shot.r, shot.c);
      if (shot.res === 'miss') { Sound.splash(); ui.busyLabel = 'Miss.'; addLog('me', `You fired at ${at}: miss.`); }
      else if (shot.res === 'hit') { Sound.boom(); ui.busyLabel = 'Direct hit!'; addLog('me-hit', `You fired at ${at}: hit!`); }
      else { Sound.sunk(); ui.busyLabel = `You sank ${oppName()}'s ${SHIP[shot.ship].name}!`; addLog('me-sunk', `You fired at ${at} and sank ${oppName()}'s ${SHIP[shot.ship].name}!`); }
      render();
    }, delay);
    checkOver(); save(); render();
  }

  function checkOver() {
    if (S.phase !== 'battle') return;
    const won = enemySunkIds().size === FLEET.length;
    const lost = allMineSunk();
    if (!won && !lost) return;
    S.phase = 'over';
    const winner = won ? S.role : other(S.role);
    if (S.scoredRound !== S.round) { S.score[winner]++; S.scoredRound = S.round; }
    S.lastWinner = winner;
    if (net) net.send({ t: 'reveal', round: S.round, ships: S.ships });
    const round = S.round;
    setTimeout(() => {
      if (S.round !== round) return;
      addLog('sys', won ? `Victory! You sank ${oppName()}'s entire fleet.` : `Defeat. ${oppName()} sank your entire fleet.`);
      render();
    }, Math.max(0, ui.busyUntil - now()));
    save();
  }

  function requestRematch() {
    if (!S || S.phase !== 'over' || S.rematch.me) return;
    S.rematch.me = true;
    net.send({ t: 'rematch', round: S.round });
    Sound.tick();
    maybeNewRound(); save(); render();
  }
  function maybeNewRound() { if (S.phase === 'over' && S.rematch.me && S.rematch.opp) newRound(S.round + 1); }
  function newRound(round) {
    Object.assign(S, {
      round, phase: 'place', ships: [], ready: false, oppReady: false, first: null,
      received: [], fired: [], pending: null, oppShips: null, rematch: { me: false, opp: false },
    });
    ui.holds.clear(); ui.busyUntil = 0; ui.lastIn = ui.lastOut = null; ui.sel = FLEET[0].id; ui.dir = 'h'; ui.overDismissed = 0;
    addLog('sys', `Round ${round}: deploy your fleet!`);
    Sound.ready();
    save();
    show('place');
    window.scrollTo(0, 0);
  }

  // ---------- placement ----------
  const nextUnplaced = () => { const f = FLEET.find(f => !S.ships.some(s => s.id === f.id)); return f ? f.id : null; };
  function previewAt(r, c) {
    const n = SHIP[ui.sel].size;
    if (ui.dir === 'h') c = Math.min(c, SIZE - n); else r = Math.min(r, SIZE - n);
    const cells = [];
    for (let i = 0; i < n; i++) cells.push(ui.dir === 'h' ? [r, c + i] : [r + i, c]);
    return { r, c, cells, ok: fits(ui.sel, r, c, ui.dir, S.ships) };
  }
  function onPlaceCell(r, c) {
    if (!S || S.phase !== 'place') return;
    if (S.ready) { toast('Click "Change my ships" to edit your fleet.'); return; }
    if (ui.sel) {
      const pv = previewAt(r, c);
      if (!pv.ok) { Sound.error(); return; }
      S.ships = S.ships.filter(s => s.id !== ui.sel).concat({ id: ui.sel, r: pv.r, c: pv.c, dir: ui.dir });
      Sound.place();
      ui.sel = nextUnplaced();
      save(); render();
    } else {
      const s = shipAt(r, c);
      if (s) { ui.sel = s.id; ui.dir = s.dir; Sound.tick(); render(); }
    }
  }
  function rotate() {
    if (!S || S.phase !== 'place' || S.ready) return;
    const turnInPlace = (s) => {
      const nd = s.dir === 'h' ? 'v' : 'h';
      if (!fits(s.id, s.r, s.c, nd, S.ships)) { Sound.error(); toast('No room to turn it there. Move it first.'); return; }
      s.dir = nd; ui.dir = nd; ui.sel = null;
      Sound.place(); save(); render();
    };
    // Mouse resting on a placed ship with nothing selected: turn that ship.
    if (!ui.sel && ui.hover) { const s = shipAt(ui.hover.r, ui.hover.c); if (s) { turnInPlace(s); return; } }
    // A placed ship is selected and there's no hover preview (phones, or mouse off the grid): turn it where it sits.
    const placedSel = ui.sel ? S.ships.find(s => s.id === ui.sel) : null;
    if (placedSel && !ui.hover) { turnInPlace(placedSel); return; }
    ui.dir = ui.dir === 'h' ? 'v' : 'h';
    Sound.tick();
    render();
  }
  function setReady(v) {
    if (!S || S.phase !== 'place') return;
    if (v && S.ships.length !== FLEET.length) return;
    S.ready = v;
    if (v) { ui.sel = null; Sound.ready(); addLog('sys', 'Your fleet is ready for battle.'); } else Sound.tick();
    if (net) net.send({ t: 'ready', v, round: S.round });
    save(); maybeStart(); render();
  }

  // ---------- visual effects ----------
  function hold(board, r, c, ms) {
    ui.holds.set(board + (r * SIZE + c), now() + ms);
    setTimeout(render, ms + 30);
  }
  const held = (board, r, c) => (ui.holds.get(board + (r * SIZE + c)) || 0) > now();
  function setBusy(ms, label) {
    ui.busyUntil = Math.max(ui.busyUntil, now() + ms);
    ui.busyLabel = label;
    setTimeout(render, ms + 40);
  }

  function focusBoard(which) {
    if (!stacked() || ui.screen !== 'battle' || document.hidden) return;
    const b = ui.boards[which];
    if (b) b.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const MISSILE_SVG = '<svg viewBox="0 0 60 20"><path class="flame" d="M18 10 L0 4 L6 10 L0 16 Z" fill="#ffb23d"/><path d="M18 10 L7 7 L10 10 L7 13 Z" fill="#fff3c4"/><rect x="16" y="7" width="32" height="6" rx="2" fill="#dfe8ff"/><path d="M48 7 L58 10 L48 13 Z" fill="#ff6a2b"/><path d="M18 7 L13 2 L25 7 Z M18 13 L13 18 L25 13 Z" fill="#8ea3d1"/></svg>';
  function flyMissile(fromEl, toBoard, r, c, ms) {
    if (!fromEl || !toBoard || document.hidden || !Element.prototype.animate) return;
    const a = fromEl.getBoundingClientRect(), cell = toBoard.cells[r * SIZE + c].getBoundingClientRect();
    if (!a.width || !cell.width) return;
    const p0 = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
    const p2 = { x: cell.left + cell.width / 2, y: cell.top + cell.height / 2 };
    const dist = Math.hypot(p2.x - p0.x, p2.y - p0.y);
    const p1 = { x: (p0.x + p2.x) / 2, y: Math.min(p0.y, p2.y) - Math.max(90, dist * 0.45) };
    const el = document.createElement('div');
    el.className = 'missile';
    el.innerHTML = MISSILE_SVG;
    document.body.appendChild(el);
    const frames = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, u = 1 - t;
      const x = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
      const y = u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y;
      const dx = 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
      const dy = 2 * u * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      const s = 0.75 + 0.6 * Math.sin(Math.PI * t);
      frames.push({ transform: `translate(${x}px, ${y}px) rotate(${ang}deg) scale(${s})`, offset: t });
    }
    const anim = el.animate(frames, { duration: ms, easing: 'cubic-bezier(.3,.1,.7,1)', fill: 'forwards' });
    const trail = setInterval(() => {
      const b = el.getBoundingClientRect();
      const p = document.createElement('div');
      p.className = 'puff';
      p.style.left = b.left + b.width / 2 + 'px';
      p.style.top = b.top + b.height / 2 + 'px';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 720);
    }, 40);
    const done = () => { clearInterval(trail); el.remove(); };
    anim.onfinish = done;
    setTimeout(done, ms + 250);
  }

  function impactFx(B, r, c, res) {
    if (!B || document.hidden) return;
    const box = document.createElement('div');
    box.className = 'fxbox';
    box.style.left = c * 10 + '%';
    box.style.top = r * 10 + '%';
    let h = '';
    if (res === 'miss') {
      h = '<i class="ripple"></i><i class="ripple r2"></i>';
      for (let i = 0; i < 7; i++) h += `<i class="drop" style="--dx:${(Math.random() * 50 - 25).toFixed(1)}px;--dy:${(-15 - Math.random() * 28).toFixed(1)}px"></i>`;
    } else {
      h = '<i class="flash"></i><i class="shock"></i>';
      const n = res === 'sunk' ? 16 : 10;
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2, d = 18 + Math.random() * (res === 'sunk' ? 60 : 40);
        h += `<i class="spark" style="--dx:${(Math.cos(ang) * d).toFixed(1)}px;--dy:${(Math.sin(ang) * d).toFixed(1)}px"></i>`;
      }
      B.sea.classList.remove('shake', 'shake-big');
      void B.sea.offsetWidth;
      B.sea.classList.add(res === 'sunk' ? 'shake-big' : 'shake');
    }
    box.innerHTML = h;
    B.fx.appendChild(box);
    setTimeout(() => box.remove(), 1300);
  }

  // ---------- rendering ----------
  function buildBoard(el) {
    el.innerHTML = '';
    const mk = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };
    const corner = mk('corner'), cols = mk('col-labels'), rows = mk('row-labels');
    for (let i = 0; i < SIZE; i++) {
      const a = document.createElement('span'); a.textContent = i + 1; cols.appendChild(a);
      const b = document.createElement('span'); b.textContent = ROWS[i]; rows.appendChild(b);
    }
    const sea = mk('sea'), cells = mk('layer cells'), ships = mk('ships'), marks = mk('layer marks'), fx = mk('ships fx');
    const cellEls = [], markEls = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const d = mk('cell'); d.dataset.r = r; d.dataset.c = c; cells.appendChild(d); cellEls.push(d);
        const m = mk('mk'); marks.appendChild(m); markEls.push(m);
      }
    }
    sea.append(cells, ships, marks, fx);
    el.append(corner, cols, rows, sea);
    return { el, sea, cells: cellEls, ships, marks: markEls, fx };
  }

  function show(name) {
    ui.screen = name;
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'scr-' + name));
    const logCard = $('logCard');
    if (name === 'place') $('placeSide').appendChild(logCard);
    else if (name === 'battle') $('battleSide').appendChild(logCard);
    logCard.classList.toggle('hidden', !(name === 'place' || name === 'battle'));
    if (name === 'msg' || name === 'home' || name === 'join') $('overlay').classList.add('hidden');
    render();
    renderLog();
  }

  function render() {
    if (!S) return;
    // Boards must never scroll internally (older browsers without overflow:clip).
    Object.values(ui.boards).forEach(b => { if (b.sea.scrollTop || b.sea.scrollLeft) { b.sea.scrollTop = 0; b.sea.scrollLeft = 0; } });
    renderPill();
    if (ui.screen === 'place') renderPlace();
    else if (ui.screen === 'battle') renderBattle();
    renderOver();
  }

  function renderPill() {
    const map = {
      idle: ['Offline', 'bad'], starting: ['Starting…', 'warn'], waiting: ['Waiting for opponent', 'warn'],
      connecting: ['Connecting…', 'warn'], 'waiting-host': ['Waiting for host', 'warn'], connected: ['Connected', 'ok'],
      reconnecting: ['Reconnecting…', 'warn'], 'opp-offline': ['Opponent offline', 'bad'], offline: ['Check your internet', 'bad'],
    };
    const [txt, cls] = map[ui.conn] || ['…', 'warn'];
    const p = $('connPill');
    p.className = 'pill ' + cls;
    $('connText').textContent = ui.conn === 'connected' && ui.connKind === 'relay' ? 'Connected (relay)' : txt;
  }

  function renderPreview() {
    if (!S || ui.screen !== 'place') return;
    const B = ui.boards.place;
    const pv = ui.sel && ui.hover && !S.ready ? previewAt(ui.hover.r, ui.hover.c) : null;
    const map = new Map();
    if (pv) pv.cells.forEach(([r, c]) => map.set(r * SIZE + c, pv.ok ? 'mk pv-ok' : 'mk pv-bad'));
    B.marks.forEach((m, i) => { const cls = map.get(i) || 'mk'; if (m.className !== cls) m.className = cls; });
  }

  function oppStatus() {
    if (S.role === 'host' && !S.guestToken) return ['Opponent', 'Waiting for your opponent to open the invite link…', false];
    if (S.role === 'guest' && !S.oppName) return ['Connecting', ui.conn === 'waiting-host' ? 'Waiting for the host to come online…' : 'Connecting to the game…', false];
    if (!net || !net.connected) return [oppName(), S.role === 'host' ? `${oppName()} is offline. Waiting for them to reconnect…` : 'Connection lost. Reconnecting…', false];
    return [S.role === 'host' ? 'Opponent joined' : 'Your opponent', S.oppReady ? `${oppName()} is ready for battle.` : `${oppName()} is deploying their fleet…`, true];
  }

  function renderPlace() {
    const B = ui.boards.place;
    B.el.classList.toggle('locked', S.ready);
    B.ships.replaceChildren(...S.ships.map(s => shipEl(s, ui.sel === s.id ? 'lifted' : '')));
    renderPreview();
    const placed = new Set(S.ships.map(s => s.id));
    $('dock').replaceChildren(...FLEET.map(f => {
      const li = document.createElement('li');
      li.className = [ui.sel === f.id ? 'sel' : '', placed.has(f.id) ? 'placed' : '', S.ready ? 'locked' : ''].join(' ').trim();
      li.dataset.id = f.id;
      li.innerHTML = `<span class="dock-name">${f.name}</span>` +
        `<span class="dock-ship"><span class="ship" style="width:${f.size * 20}px">${shipSVG(f.id, 'h')}</span></span>` +
        `<span class="dock-size">${f.size} squares</span>`;
      return li;
    }));
    const all = S.ships.length === FLEET.length;
    const rb = $('readyBtn');
    rb.disabled = !all || S.ready;
    rb.textContent = S.ready ? (S.oppReady ? 'Starting the battle…' : 'Ready. Waiting for ' + (S.oppName ? oppName() : 'your opponent') + '…') : 'Ready for battle';
    $('unreadyBtn').classList.toggle('hidden', !S.ready);
    $('readyNote').textContent = !all
      ? `Place ${FLEET.length - S.ships.length} more ship${FLEET.length - S.ships.length === 1 ? '' : 's'}, or press Random.`
      : S.ready ? '' : 'The battle starts when both captains are ready.';
    ['rotateBtn', 'randomBtn', 'clearBtn'].forEach(id => { $(id).disabled = S.ready; });
    const selUnplaced = ui.sel && !S.ships.some(s => s.id === ui.sel);
    $('rotateBtn').textContent = selUnplaced ? `Rotate: ${ui.dir === 'h' ? 'horizontal' : 'vertical'}` : (TOUCH ? 'Rotate' : 'Rotate (R)');
    $('placeRound').textContent = S.round > 1 ? 'Round ' + S.round : '';
    $('inviteCard').classList.toggle('hidden', !(S.role === 'host' && !S.guestToken));
    const [kick, text, joined] = oppStatus();
    $('oppKicker').textContent = kick;
    $('oppText').textContent = text;
    $('oppCard').classList.toggle('joined', joined);
  }

  function renderBattle() {
    const T = ui.boards.target, O = ui.boards.own;
    $('enemyTag').textContent = oppName();
    $('myTag').textContent = S.myName;

    // --- enemy waters ---
    const visFired = S.fired.filter(x => !held('t', x.r, x.c));
    const firedAt = new Set(S.fired.map(x => x.r * SIZE + x.c));
    const visMap = new Map(visFired.map(x => [x.r * SIZE + x.c, x]));
    const sunkShots = visFired.filter(x => x.res === 'sunk');
    const sunkCells = new Set();
    sunkShots.forEach(x => x.cells.forEach(([r, c]) => sunkCells.add(r * SIZE + c)));
    T.el.classList.toggle('armed', canFire());
    T.cells.forEach((cell, i) => cell.classList.toggle('done', firedAt.has(i)));
    T.marks.forEach((m, i) => {
      const r = Math.floor(i / SIZE), c = i % SIZE, x = visMap.get(i);
      let cls = 'mk';
      if (x) cls += x.res === 'miss' ? ' miss' : sunkCells.has(i) ? ' sunk' : ' hit';
      else if (firedAt.has(i) || (S.pending && S.pending.r === r && S.pending.c === c)) cls += ' aim';
      if (x && ui.lastOut === i) cls += ' last';
      if (m.className !== cls) m.className = cls;
    });
    const tShips = sunkShots.map(x => shipEl(shipFromCells(x.ship, x.cells), 'sunk'));
    if (S.phase === 'over' && !busy() && S.oppShips) {
      const sunkIds = enemySunkIds(visFired);
      S.oppShips.filter(s => !sunkIds.has(s.id)).forEach(s => tShips.push(shipEl(s, 'ghost')));
    }
    T.ships.replaceChildren(...tShips);

    // --- my fleet ---
    const visRecv = S.received.filter(x => !held('o', x.r, x.c));
    const myHits = hitSetOf(visRecv);
    const recvMap = new Map(visRecv.map(x => [x.r * SIZE + x.c, x]));
    const recvAll = new Set(S.received.map(x => x.r * SIZE + x.c));
    const mySunkCells = new Set();
    S.ships.forEach(s => { if (isSunk(s, myHits)) cellsOf(s).forEach(([r, c]) => mySunkCells.add(r * SIZE + c)); });
    O.ships.replaceChildren(...S.ships.map(s => shipEl(s, isSunk(s, myHits) ? 'sunk' : '')));
    O.marks.forEach((m, i) => {
      const x = recvMap.get(i);
      let cls = 'mk';
      if (x) cls += x.res === 'miss' ? ' miss' : mySunkCells.has(i) ? ' sunk' : ' hit';
      else if (recvAll.has(i)) cls += ' aim';
      if (x && ui.lastIn === i) cls += ' last';
      if (m.className !== cls) m.className = cls;
    });

    // --- fleet status chips ---
    const eSunk = enemySunkIds(visFired);
    $('enemyFleet').replaceChildren(...FLEET.map(f => chip(f, eSunk.has(f.id), null)));
    $('myFleet').replaceChildren(...FLEET.map(f => {
      const s = S.ships.find(x => x.id === f.id);
      const segs = s ? cellsOf(s).map(([r, c]) => myHits.has(r * SIZE + c)) : [];
      return chip(f, s ? isSunk(s, myHits) : false, segs);
    }));

    // --- stats & score ---
    const hits = S.fired.filter(x => x.res !== 'miss').length;
    $('stShots').textContent = S.fired.length;
    $('stHits').textContent = hits;
    $('stAcc').textContent = S.fired.length ? Math.round(100 * hits / S.fired.length) + '%' : '–';
    const sl = $('scoreLine');
    sl.replaceChildren();
    const nm = (t) => { const s = document.createElement('span'); s.className = 'nm'; s.textContent = t; return s; };
    const sc = document.createElement('span'); sc.className = 'sc';
    sc.textContent = `${S.score[S.role]} – ${S.score[other(S.role)]}`;
    sl.append(nm(S.myName), sc, nm(oppName()));

    renderTurn();
  }

  function chip(f, sunk, segs) {
    const d = document.createElement('div');
    d.className = 'chip' + (sunk ? ' sunk' : '');
    const name = document.createElement('span'); name.textContent = f.name;
    const sg = document.createElement('span'); sg.className = 'segs';
    for (let i = 0; i < f.size; i++) { const b = document.createElement('i'); if (segs && segs[i]) b.className = 'h'; sg.appendChild(b); }
    d.append(name, sg);
    return d;
  }

  function renderTurn() {
    let cls = '', txt = '';
    const overVisible = S.phase === 'over' && !busy();
    if (overVisible) {
      const won = S.lastWinner === S.role;
      cls = won ? 'win' : 'lose';
      txt = won ? `Victory! You sank ${oppName()}'s fleet.` : `Defeat. ${oppName()} sank your fleet.`;
    } else if (!net || !net.connected) {
      cls = 'warn';
      txt = S.role === 'host' ? `${oppName()} is offline. Waiting for them to reconnect…` : 'Connection lost. Reconnecting…';
    } else if (S.pending || busy()) {
      cls = 'busy'; txt = ui.busyLabel || 'Missile away…';
    } else if (myTurn()) {
      cls = 'mine'; txt = 'Your turn. Fire on enemy waters.';
    } else {
      txt = `${oppName()} is taking aim…`;
    }
    $('turnBar').className = 'turnbar ' + cls;
    $('turnText').textContent = txt;
    $('turnRematch').classList.toggle('hidden', !(overVisible && ui.overDismissed === S.round && !S.rematch.me));
    document.title = (cls === 'mine' ? '(Your turn) ' : '') + 'Battleship Live';
  }

  function renderOver() {
    const ready = S.phase === 'over' && !busy() && ui.screen === 'battle';
    if (ready && S.celebrated !== S.round) {
      S.celebrated = S.round; save();
      if (S.lastWinner === S.role) Sound.victory(); else Sound.defeat();
    }
    const visible = ready && ui.overDismissed !== S.round;
    $('overlay').classList.toggle('hidden', !visible);
    if (!visible) return;
    const won = S.lastWinner === S.role;
    const card = document.querySelector('.over-card');
    card.classList.toggle('win', won); card.classList.toggle('lose', !won);
    $('overKicker').textContent = won ? 'Enemy fleet destroyed' : 'Your fleet is lost';
    $('overTitle').textContent = won ? 'Victory!' : 'Defeat';
    $('overText').textContent = won
      ? `You sank ${oppName()}'s fleet in ${S.fired.length} shots.`
      : `${oppName()} sank your fleet in ${S.received.length} shots.`;
    const hits = S.fired.filter(x => x.res !== 'miss').length;
    const st = $('overStats');
    st.replaceChildren();
    [[S.fired.length, 'Your shots'], [hits, 'Your hits'], [S.fired.length ? Math.round(100 * hits / S.fired.length) + '%' : '–', 'Accuracy']].forEach(([v, l]) => {
      const d = document.createElement('div'), s = document.createElement('span'), lb = document.createElement('label');
      s.textContent = v; lb.textContent = l; d.append(s, lb); st.appendChild(d);
    });
    const rb = $('rematchBtn');
    rb.disabled = S.rematch.me;
    rb.textContent = S.rematch.me ? `Waiting for ${oppName()}…` : 'Rematch';
    $('rematchNote').textContent = !net.connected ? `${oppName()} is offline right now.`
      : S.rematch.opp ? `${oppName()} wants a rematch!` : `Score: ${S.myName} ${S.score[S.role]}, ${oppName()} ${S.score[other(S.role)]}`;
  }

  function renderLog() {
    if (!S) return;
    const ul = $('log');
    ul.replaceChildren(...S.log.map(e => {
      const li = document.createElement('li');
      li.className = e.k;
      if (e.n) { const b = document.createElement('b'); b.textContent = e.n + ': '; li.append(b); }
      li.append(document.createTextNode(e.x));
      return li;
    }));
    ul.scrollTop = ul.scrollHeight;
  }

  function addLog(kind, text, name) {
    S.log.push({ k: kind, x: text, n: name || undefined, at: now() });
    if (S.log.length > 160) S.log.splice(0, S.log.length - 160);
    save();
    renderLog();
  }

  function renderMute() {
    const on = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>';
    const off = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>';
    $('muteBtn').innerHTML = Sound.isMuted() ? off : on;
    $('muteBtn').title = Sound.isMuted() ? 'Sound is off' : 'Sound is on';
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(ui.toastT);
    ui.toastT = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function showMsg(title, text) {
    $('msgTitle').textContent = title;
    $('msgText').textContent = text;
    show('msg');
  }

  // ---------- invites ----------
  const inviteLink = () => location.href.split('#')[0].split('?')[0] + '#g=' + S.code;
  const inviteText = () => `${S.myName} has challenged you to a live game of Battleship!\n\nClick to join: ${inviteLink()}\n\nGame code: ${S.code}\n\nYou'll each play on your own computer. Turn your sound on!`;
  const mailtoHref = () => 'mailto:?subject=' + encodeURIComponent(`${S.myName} challenges you to Battleship`) + '&body=' + encodeURIComponent(inviteText());
  async function copyText(text, okMsg) {
    try { await navigator.clipboard.writeText(text); toast(okMsg); return; } catch (e) { /* fall back */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(okMsg); } catch (e) { toast('Copy failed. Select the link and copy it.'); }
    ta.remove();
  }

  // ---------- sessions ----------
  function startSession() {
    sess.set(K.tab + S.code, S.role);
    save();
    const beat = () => store.set(K.alive + S.code + ':' + S.role, now());
    beat();
    setInterval(beat, 2000);
    window.addEventListener('pagehide', () => store.del(K.alive + S.code + ':' + S.role));
    if (S.phase === 'place' && !S.ready && !ui.sel) ui.sel = nextUnplaced();
    $('inviteLink').value = inviteLink();
    $('inviteCode').textContent = S.code;
    $('emailBtn').href = mailtoHref();
    if (navigator.share) $('shareBtn').classList.remove('hidden');
    $('codeTag').textContent = 'GAME ' + S.code;
    $('codeTag').classList.remove('hidden');
    $('connPill').classList.remove('hidden');
    ui.conn = S.role === 'host' ? 'starting' : 'connecting';
    net = new window.Net({
      code: S.code, role: S.role, token: S.token,
      makeHello: () => ({ t: 'hello', sync: mySync() }),
      onMessage, onStatus, onFatal,
    });
    net.start();
    show(S.phase === 'place' ? 'place' : 'battle');
  }

  function resume(code, role) {
    const st = store.get(K.game + code + ':' + role);
    if (!st || st.v !== VERSION || st.code !== code || st.role !== role) return false;
    S = st;
    startSession();
    return true;
  }

  function createGame() {
    Sound.unlock();
    const name = cleanName($('nameHome').value) || 'Captain';
    store.set(K.name, name);
    S = newState(randStr(6), 'host', name);
    history.replaceState(null, '', location.pathname + location.search + '#g=' + S.code);
    startSession();
    Sound.ping();
  }

  function joinWith(code, nameInput) {
    Sound.unlock();
    const name = cleanName($(nameInput).value) || 'Captain';
    store.set(K.name, name);
    S = newState(code, 'guest', name);
    history.replaceState(null, '', location.pathname + location.search + '#g=' + code);
    startSession();
  }

  function codeFromHash() {
    const m = location.hash.match(/g=([A-Za-z0-9]{6})/);
    if (!m) return null;
    const c = cleanCode(m[1]);
    return validCode(c) ? c : null;
  }

  function pruneOld() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      keys.forEach(k => {
        if (!k) return;
        if (k.startsWith(K.game)) { const st = store.get(k); if (!st || now() - (st.savedAt || 0) > 5 * 86400e3) store.del(k); }
        else if (k.startsWith(K.alive) && now() - (+store.get(k) || 0) > 86400e3) store.del(k);
      });
    } catch (e) { /* ignore */ }
  }

  function sendChat() {
    const inp = $('chatInput');
    const text = inp.value.trim().slice(0, 200);
    if (!text || !S) return;
    if (!net || !net.connected) { toast('Not connected to your opponent yet.'); return; }
    net.send({ t: 'chat', text });
    addLog('chat mine', text, S.myName);
    inp.value = '';
  }

  // ---------- wiring ----------
  function wire() {
    // iPhone only allows audio to start inside certain gestures (touchend/click, not touch pointerdown).
    ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'].forEach(ev =>
      document.addEventListener(ev, () => Sound.unlock(), { passive: true, capture: true }));
    // Safari restores pages from its back/forward cache with dead connections: reload instead (state is saved).
    window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
    $('muteBtn').onclick = () => { Sound.setMuted(!Sound.isMuted()); renderMute(); if (!Sound.isMuted()) Sound.tick(); };

    $('createBtn').onclick = createGame;
    $('nameHome').addEventListener('keydown', e => { if (e.key === 'Enter') createGame(); });
    $('codeInput').addEventListener('input', e => { e.target.value = cleanCode(e.target.value).slice(0, 6); $('homeErr').textContent = ''; });
    $('joinCodeBtn').onclick = () => {
      const c = cleanCode($('codeInput').value);
      if (!validCode(c)) { $('homeErr').textContent = 'Game codes are 6 letters and numbers, like K7QX2M.'; Sound.error(); return; }
      joinWith(c, 'nameHome');
    };
    $('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinCodeBtn').click(); });
    $('joinBtn').onclick = () => { const c = codeFromHash(); if (c) joinWith(c, 'nameJoin'); };
    $('nameJoin').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });

    const P = ui.boards.place;
    // Hover preview only for a real mouse/pen; taps would otherwise leave a stale preview behind.
    P.sea.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      const cell = e.target.closest('.cell');
      if (!cell) return;
      const h = { r: +cell.dataset.r, c: +cell.dataset.c };
      if (!ui.hover || ui.hover.r !== h.r || ui.hover.c !== h.c) { ui.hover = h; renderPreview(); }
    });
    P.sea.addEventListener('pointerleave', () => { if (ui.hover) { ui.hover = null; renderPreview(); } });
    P.sea.addEventListener('pointerdown', e => { if (e.pointerType === 'touch' && ui.hover) { ui.hover = null; renderPreview(); } });
    P.sea.addEventListener('click', e => { const cell = e.target.closest('.cell'); if (cell) onPlaceCell(+cell.dataset.r, +cell.dataset.c); });
    P.sea.addEventListener('contextmenu', e => { e.preventDefault(); rotate(); });
    $('dock').addEventListener('click', e => {
      const li = e.target.closest('li');
      if (!li || !S || S.ready) return;
      ui.sel = ui.sel === li.dataset.id ? null : li.dataset.id;
      const s = S.ships.find(x => x.id === ui.sel);
      if (s) ui.dir = s.dir;
      Sound.tick(); render();
    });
    $('rotateBtn').onclick = rotate;
    $('randomBtn').onclick = () => { if (!S || S.ready) return; S.ships = randomFleet(); ui.sel = null; Sound.place(); save(); render(); };
    $('clearBtn').onclick = () => { if (!S || S.ready) return; S.ships = []; ui.sel = FLEET[0].id; Sound.tick(); save(); render(); };
    $('readyBtn').onclick = () => setReady(true);
    $('unreadyBtn').onclick = () => setReady(false);

    ui.boards.target.sea.addEventListener('click', e => { const cell = e.target.closest('.cell'); if (cell) onTargetClick(+cell.dataset.r, +cell.dataset.c); });

    document.addEventListener('keydown', e => {
      if (e.target.matches('input, textarea')) return;
      if ((e.key === 'r' || e.key === 'R') && ui.screen === 'place') { e.preventDefault(); rotate(); }
      if (e.key === 'Escape' && ui.screen === 'place' && S && !S.ready) { ui.sel = null; render(); }
    });

    $('copyLinkBtn').onclick = () => copyText(inviteLink(), 'Invite link copied');
    $('copyInviteBtn').onclick = () => copyText(inviteText(), 'Invite message copied. Paste it into an email or text.');
    $('shareBtn').onclick = () => navigator.share({ title: 'Battleship Live', text: `${S.myName} has challenged you to Battleship!`, url: inviteLink() }).catch(() => {});
    $('inviteLink').onclick = e => e.target.select();

    $('chatForm').addEventListener('submit', e => { e.preventDefault(); sendChat(); });
    $('rematchBtn').onclick = requestRematch;
    $('turnRematch').onclick = requestRematch;
    $('viewBtn').onclick = () => { ui.overDismissed = S.round; render(); };
    document.querySelector('.brand').addEventListener('click', e => {
      if (S && S.phase === 'battle' && !confirm('Leave this game? You can come back with the same link.')) e.preventDefault();
    });
    window.addEventListener('hashchange', () => location.reload());
  }

  function boot() {
    ui.boards.place = buildBoard($('placeBoard'));
    ui.boards.target = buildBoard($('targetBoard'));
    ui.boards.own = buildBoard($('ownBoard'));
    wire();
    renderMute();
    pruneOld();
    if (TOUCH) $('placeHint').textContent = 'Tap a ship in your fleet, then tap the grid. To turn a placed ship, tap it, then tap Rotate. To move one, tap it, then tap a new spot.';
    const name = store.get(K.name) || '';
    $('nameHome').value = name;
    $('nameJoin').value = name;

    const code = codeFromHash();
    if (!code) { show('home'); return; }
    const tabRole = sess.get(K.tab + code);
    if ((tabRole === 'host' || tabRole === 'guest') && resume(code, tabRole)) return;
    for (const role of ['host', 'guest']) {
      if (store.get(K.game + code + ':' + role) && now() - aliveAt(code, role) > 6000 && resume(code, role)) return;
    }
    $('joinCode').textContent = code;
    show('join');
    setTimeout(() => $('nameJoin').focus(), 50);
  }

  // Small hook for automated testing / debugging in the console.
  window.__bs = { get S() { return S; }, get net() { return net; }, ui, myTurn, canFire };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
