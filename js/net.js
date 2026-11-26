/* Battleship Live: networking.
 *
 * Primary transport: direct browser-to-browser WebRTC data channel via PeerJS
 * (free public signaling server, plus PeerJS's public TURN relay for tough networks).
 * Fallback transport: public MQTT brokers over secure WebSockets, used automatically
 * if a direct connection can't be made within a few seconds.
 *
 * The host's computer listens on both. The guest tries direct first, then the relay.
 * Each player's computer is the authority for its own board: shots are resolved by the
 * defender's computer and only the result (miss / hit / sunk) is sent back.
 */
window.Net = (() => {
  'use strict';
  const PEER_PREFIX = 'bslive-v1-';
  const TOPIC = 'bslive/v1/';
  const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
  const P2P_TIMEOUT = 12000;   // give up on a direct connection after this long
  const HELLO_EVERY = 3000;    // guest re-sends its hello until welcomed
  const PING_EVERY = 5000;
  const LIVE_TIMEOUT = 70000;  // long, because background tabs throttle timers
  const FATAL_PEER = ['browser-incompatible', 'invalid-id', 'invalid-key', 'ssl-unavailable', 'server-error', 'socket-error', 'socket-closed'];

  const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789';
  const rand = (n) => { const b = new Uint32Array(n); crypto.getRandomValues(b); return Array.from(b, x => ALPHA[x % ALPHA.length]).join(''); };
  const qs = new URLSearchParams(location.search);

  class Net {
    constructor({ code, role, token, makeHello, onMessage, onStatus, onFatal }) {
      Object.assign(this, { code, role, token, makeHello, onMessage, onStatus, onFatal });
      this.sid = rand(8); this.seq = 0;
      this.active = null; this.peerToken = null; this.welcomed = false; this.everAdopted = false;
      this.lastRecv = 0; this.lastSent = 0; this.lastHello = 0; this.lastPong = 0;
      this.seen = new Set(); this.seenQ = [];
      this.peer = null; this.dial = null; this.signalOk = false; this.peerUnavail = 0;
      this.mqtts = []; this.relayChs = new Map(); this.relayEntry = null; this.relayWanted = false;
      this.helloChs = new Set();
      this.status = ''; this.statusKey = ''; this.destroyed = false;
      this.mode = qs.get('relay') === '1' ? 'relay' : qs.get('relay') === '0' ? 'p2p' : 'auto';
    }

    get connected() { return !!this.active && (this.role === 'host' || this.welcomed); }
    get kind() { return this.active ? this.active.kind : null; }
    isLive() { return this.connected && Date.now() - this.lastRecv < 15000; }

    start() {
      if (this.role === 'host') this._hostStart(); else this._guestStart();
      this._timer = setInterval(() => this._tick(), 1000);
      window.addEventListener('pagehide', () => { if (this.active) this._raw(this.active, { t: 'bye' }); });
      document.addEventListener('visibilitychange', () => {
        if (this.destroyed) return;
        if (document.visibilityState === 'visible') this._probe();
      });
      window.addEventListener('online', () => this._probe());
    }

    // Phones (iPhone especially) freeze the page when locked or switched away from, which can
    // silently kill the connection. On return, check the link; if it's dead, rebuild it fast.
    _probe() {
      if (this.destroyed) return;
      if (!this.connected) {
        if (this.role === 'guest') this._guestConnect(); else this._kick();
        return;
      }
      const sentAt = Date.now();
      this.send({ t: 'ping', probe: 1 });
      this._schedule(() => {
        if (!this.connected || this.lastPong >= sentAt) return;
        this._lost(this.active);              // guest: reconnects; host: marks opponent offline
        if (this.role === 'host') this._kick();
      }, 4000);
    }

    // Host: ask the guest, through the relay, to reconnect right away.
    _kick() {
      if (this.role !== 'host' || !this.peerToken || !this.mqtts.length) return;
      const topic = `${TOPIC}${this.code}/g/${this.peerToken}`;
      let tries = 0;
      const send = () => {
        if (this.destroyed || this.connected || tries++ >= 5) return;
        const body = JSON.stringify({ t: 'rejoin', mid: this.sid + '.' + (++this.seq) });
        this.mqtts.forEach(m => { try { m.client.publish(topic, body, { qos: 1 }); } catch (e) { /* queued or offline */ } });
        this._schedule(send, 3000);
      };
      send();
    }

    destroy() {
      this.destroyed = true;
      clearInterval(this._timer);
      try { if (this.peer) this.peer.destroy(); } catch (e) { /* ignore */ }
      this.mqtts.forEach(m => { try { m.client.end(true); } catch (e) { /* ignore */ } });
    }

    send(msg) { return this.active ? this._raw(this.active, msg) : false; }
    sendVia(ch, msg) { return this._raw(ch, msg); }

    // host: make a guest's channel the active one
    adopt(ch, tk) {
      this.active = ch; this.peerToken = tk; this.everAdopted = true;
      this.lastRecv = Date.now();
      this._setStatus('connected');
    }

    // ---------- internals ----------
    _raw(ch, msg) {
      const env = Object.assign({}, msg, { mid: this.sid + '.' + (++this.seq) });
      if (this.role === 'guest') env.tk = this.token;
      try { ch.send(env); if (ch === this.active) this.lastSent = Date.now(); return true; } catch (e) { return false; }
    }

    _setStatus(s) {
      const key = s + ':' + (this.kind || '');
      if (this.statusKey === key) return;
      this.status = s; this.statusKey = key;
      this.onStatus(s, this.kind);
    }

    _schedule(fn, ms) { setTimeout(() => { if (!this.destroyed) fn(); }, ms); }

    _recv(o, ch) {
      if (this.destroyed || !o || typeof o !== 'object' || typeof o.t !== 'string') return;
      if (o.mid) {
        if (this.seen.has(o.mid)) return;
        this.seen.add(o.mid); this.seenQ.push(o.mid);
        if (this.seenQ.length > 800) this.seen.delete(this.seenQ.shift());
      }
      if (o.t === 'rejoin') {                  // host asked us to rebuild the connection
        if (this.role === 'guest') { if (this.active) this._lost(this.active); else this._guestConnect(); }
        return;
      }
      if (this.role === 'guest') {
        if (o.t === 'welcome') {
          this.welcomed = true; this.active = ch; this.helloChs.clear(); this.peerUnavail = 0;
          this.lastRecv = Date.now();
          this._setStatus('connected');
        } else if (o.t !== 'full' && !this.welcomed) {
          return;
        }
        this.lastRecv = Date.now();
      } else if (o.tk && o.tk === this.peerToken) {
        this.lastRecv = Date.now();
      }
      if (o.t === 'ping') { if (o.probe) this._raw(ch, { t: 'pong' }); return; }
      if (o.t === 'pong') { this.lastPong = Date.now(); return; }
      if (o.t === 'bye') {
        if (this.role === 'guest' || o.tk === this.peerToken) this._lost(this.active);
        return;
      }
      this.onMessage(o, ch);
    }

    _lost(ch) {
      if (!ch) return;
      if (this.active !== ch) { this.helloChs.delete(ch); return; }
      this.active = null;
      if (ch.kind === 'p2p' && ch.conn && typeof ch.conn.close === 'function') { try { ch.conn.close(); } catch (e) { /* ignore */ } }
      if (this.role === 'guest') {
        this.welcomed = false;
        this._setStatus('reconnecting');
        this._schedule(() => this._guestConnect(), 1200);
      } else {
        this._setStatus('opp-offline');
      }
    }

    _tick() {
      if (this.destroyed) return;
      const now = Date.now();
      if (this.role === 'guest' && !this.welcomed && this.helloChs.size && now - this.lastHello > HELLO_EVERY) this._sendHellos();
      if (this.connected) {
        if (now - this.lastSent > PING_EVERY) this.send({ t: 'ping' });
        if (now - this.lastRecv > LIVE_TIMEOUT) this._lost(this.active);
        else if (this.active && this.active.kind === 'p2p' && this.active.opened && !this.active.conn.open) this._lost(this.active);
      }
    }

    _wireConn(conn) {
      const ch = {
        kind: 'p2p', conn, opened: !!conn.open,
        send: (m) => { if (!conn.open) throw new Error('closed'); conn.send(m); },
      };
      conn.on('open', () => { ch.opened = true; });
      conn.on('data', (d) => {
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
        this._recv(d, ch);
      });
      conn.on('close', () => this._lost(ch));
      conn.on('error', () => this._lost(ch));
      return ch;
    }

    // ---------- host ----------
    _hostStart() {
      this._setStatus('starting');
      this._hostPeer(0);
      this._mqttStart();
      this._schedule(() => {
        if (!this.signalOk && !this.mqtts.some(m => m.ok) && !this.connected) this._setStatus('offline');
      }, 15000);
    }

    _hostIdle() { if (!this.connected) this._setStatus(this.everAdopted ? 'opp-offline' : 'waiting'); }

    _hostPeer(attempt) {
      if (this.destroyed) return;
      if (!Net.p2pSupported()) return;
      const peer = this.peer = new Peer(PEER_PREFIX + this.code.toLowerCase(), { debug: 1 });
      peer.on('open', () => { this.signalOk = true; this._hostIdle(); });
      peer.on('connection', (conn) => this._wireConn(conn));
      peer.on('disconnected', () => {
        this.signalOk = false;
        this._schedule(() => { if (this.peer === peer && !peer.destroyed && peer.disconnected) { try { peer.reconnect(); } catch (e) { /* retry later */ } } }, 2500);
      });
      peer.on('error', (err) => {
        const type = err && err.type;
        if (type === 'unavailable-id') {
          // Usually the previous copy of this page (before a refresh) hasn't been released yet.
          try { peer.destroy(); } catch (e) { /* ignore */ }
          if (attempt < 25) this._schedule(() => this._hostPeer(attempt + 1), 3000);
          else this.onFatal('taken');
          return;
        }
        if (peer.destroyed || FATAL_PEER.includes(type) || type === 'network') {
          this._schedule(() => {
            if (this.peer !== peer) return;
            if (peer.destroyed) this._hostPeer(attempt);
            else if (peer.disconnected) { try { peer.reconnect(); } catch (e) { /* ignore */ } }
          }, 5000);
        }
      });
    }

    // ---------- guest ----------
    _guestStart() {
      this._setStatus('connecting');
      this._mqttStart();
      this._guestConnect();
    }

    _guestConnect() {
      if (this.destroyed || this.connected) return;
      if (this.mode === 'relay' || !Net.p2pSupported()) { this._relayHello(); return; }
      this._ensureGuestPeer(() => this._dialNow());
    }

    _ensureGuestPeer(cb) {
      if (this.peer && !this.peer.destroyed) {
        if (this.peer.open) cb();
        else {
          this._onPeerOpen = cb;
          if (this.peer.disconnected) { try { this.peer.reconnect(); } catch (e) { /* ignore */ } }
        }
        return;
      }
      const peer = this.peer = new Peer({ debug: 1 });
      this._onPeerOpen = cb;
      peer.on('open', () => {
        this.signalOk = true;
        const f = this._onPeerOpen; this._onPeerOpen = null;
        if (f) f();
      });
      peer.on('disconnected', () => {
        this.signalOk = false;
        this._schedule(() => { if (this.peer === peer && !peer.destroyed && peer.disconnected) { try { peer.reconnect(); } catch (e) { /* ignore */ } } }, 2500);
      });
      peer.on('error', (err) => this._guestPeerError(err, peer));
    }

    _dialNow() {
      if (this.destroyed || this.connected || this.dial || !this.peer) return;
      let conn;
      try { conn = this.peer.connect(PEER_PREFIX + this.code.toLowerCase(), { reliable: true, serialization: 'json' }); } catch (e) { conn = null; }
      if (!conn) { this._relayHello(); return; }
      const ch = this._wireConn(conn);
      const dial = this.dial = {
        conn,
        timer: setTimeout(() => {
          if (this.dial !== dial) return;
          this.dial = null;
          try { conn.close(); } catch (e) { /* ignore */ }
          // Direct connection blocked: use the relay, and try direct again later.
          this._relayHello();
          this._schedule(() => this._guestConnect(), 20000);
        }, P2P_TIMEOUT),
      };
      conn.on('open', () => {
        if (this.dial === dial) { clearTimeout(dial.timer); this.dial = null; }
        if (this.connected) return;
        this.helloChs.add(ch);
        this._sendHellos();
      });
    }

    _guestPeerError(err, peer) {
      const type = err && err.type;
      if (type === 'peer-unavailable') {
        // The host isn't online (yet). Keep knocking.
        if (this.dial) { clearTimeout(this.dial.timer); this.dial = null; }
        this.peerUnavail++;
        if (!this.connected) this._setStatus('waiting-host');
        if (this.peerUnavail >= 2) this._relayHello();
        this._schedule(() => this._guestConnect(), 3500);
        return;
      }
      if (peer.destroyed || FATAL_PEER.includes(type) || type === 'network') {
        if (this.dial) { clearTimeout(this.dial.timer); this.dial = null; }
        this._relayHello();
        this._schedule(() => {
          if (this.kind === 'p2p' || this.peer !== peer) return;
          try { peer.destroy(); } catch (e) { /* ignore */ }
          this.peer = null;
          this._guestConnect();
        }, 5000);
      }
    }

    _sendHellos() {
      if (this.welcomed || !this.helloChs.size) return;
      const hello = this.makeHello();
      this.helloChs.forEach(ch => this._raw(ch, hello));
      this.lastHello = Date.now();
    }

    // ---------- relay (MQTT) ----------
    _mqttStart() {
      if (this.mode === 'p2p' || typeof mqtt === 'undefined' || this.mqtts.length) return;
      const sub = this.role === 'host' ? `${TOPIC}${this.code}/h` : `${TOPIC}${this.code}/g/${this.token}`;
      BROKERS.forEach((url, i) => {
        let client;
        try {
          client = mqtt.connect(url, { clientId: 'bsl_' + rand(12), clean: true, connectTimeout: 8000, reconnectPeriod: 4000, keepalive: 30 });
        } catch (e) { return; }
        const entry = { i, url, client, ok: false };
        this.mqtts.push(entry);
        client.on('connect', () => {
          entry.ok = true;
          client.subscribe(sub, { qos: 1 });
          if (this.role === 'host') this._hostIdle();
          else if (this.relayWanted && !this.connected) this._relayHello();
        });
        client.on('message', (topic, payload) => {
          let o;
          try { o = JSON.parse(typeof payload === 'string' ? payload : new TextDecoder().decode(payload)); } catch (e) { return; }
          this._recv(o, this._relayCh(entry, o));
        });
        client.on('offline', () => { entry.ok = false; });
        client.on('close', () => { entry.ok = false; });
        client.on('error', () => { /* reconnects automatically */ });
      });
    }

    // One relay channel per destination topic. Each message is published on every connected
    // broker (both sides subscribe on all of them); duplicates are dropped by message id.
    _relayCh(entry, o) {
      const topic = this.role === 'host' ? `${TOPIC}${this.code}/g/${o && o.tk}` : `${TOPIC}${this.code}/h`;
      let ch = this.relayChs.get(topic);
      if (!ch) {
        ch = {
          kind: 'relay',
          send: (m) => {
            const live = this.mqtts.filter(x => x.ok);
            if (!live.length) throw new Error('relay offline');
            const body = JSON.stringify(m);
            live.forEach(x => x.client.publish(topic, body, { qos: 1 }));
          },
        };
        this.relayChs.set(topic, ch);
      }
      return ch;
    }

    _relayHello() {
      if (this.role !== 'guest' || this.mode === 'p2p' || this.destroyed || this.connected) return;
      this.relayWanted = true;
      this._mqttStart();
      if (!this.mqtts.some(m => m.ok)) return; // runs again when a broker connects
      this.helloChs.add(this._relayCh(null, null));
      this._sendHellos();
    }
  }

  // Direct connections need PeerJS loaded and WebRTC in the browser; otherwise the relay is used.
  Net.p2pSupported = () => typeof Peer !== 'undefined' && typeof RTCPeerConnection !== 'undefined';

  return Net;
})();
