import { loadTrystero } from './trystero.js';

// Networking session. Pure P2P through Trystero's Nostr strategy.
//
//   peer state: { x, y, facing, walkPhase, alive, specSeed, username, color,
//                 renderX, renderY }
//
// Host election: deterministic by lowest peer ID across selfId + all peer IDs.
// Migration happens automatically on every peer-set change.
//
// Pose broadcast: 15 Hz throttled inside tick(). Chat broadcast: event-driven.

export function createNetwork({ appId, roomId, getLocalPose }) {
  const peers = new Map();
  let selfId = null;
  let hostId = null;
  let room = null;
  let sendPose = null;
  let sendChat = null;
  let status = 'connecting';
  let broadcastAcc = 0;
  const BROADCAST_HZ = 15;

  const chatListeners = new Set();
  const statusListeners = new Set();
  const peerListeners = new Set();
  const hostListeners = new Set();
  const peerJoinListeners = new Set();
  const peerLeaveListeners = new Set();
  const rosterAnnListeners = new Set();
  const rosterFullListeners = new Set();
  const sessionListeners = new Set();
  const aliensListeners = new Set();
  const shotListeners = new Set();
  const hitListeners = new Set();
  const killListeners = new Set();
  let sendRosterAnn = null;
  let sendRosterFull = null;
  let sendSession = null;
  let sendAliens = null;
  let sendShot = null;
  let sendHit = null;
  let sendKill = null;

  function fireStatus() { for (const l of statusListeners) l(status); }
  function firePeers() { for (const l of peerListeners) l(peers); }
  function fireHost(prev) { for (const l of hostListeners) l(hostId, prev); }

  function recomputeHost() {
    const ids = [selfId, ...peers.keys()].filter(Boolean).sort();
    const next = ids[0] || null;
    if (next !== hostId) {
      const prev = hostId;
      hostId = next;
      fireHost(prev);
    }
  }

  function broadcastPose() {
    if (!sendPose) return;
    try { sendPose(getLocalPose()); } catch (e) { /* peer dropped mid-send */ }
  }

  async function connect() {
    // Assign a local selfId immediately so the player can be elected host
    // even before Trystero connects (enables solo play and offline dev).
    selfId = 'local-' + Math.random().toString(36).slice(2, 10);
    recomputeHost();
    try {
      const { joinRoom, selfId: sid } = await loadTrystero();
      selfId = sid;
      room = joinRoom({ appId }, roomId);

      const [sp, gp] = room.makeAction('pose');
      const [sc, gc] = room.makeAction('chat');
      const [sra, gra] = room.makeAction('rosterA');
      const [srf, grf] = room.makeAction('rosterF');
      const [sse, gse] = room.makeAction('session');
      const [sa, ga]   = room.makeAction('aliens');
      const [sSh, gSh] = room.makeAction('shot');
      const [sHt, gHt] = room.makeAction('hit');
      const [sKl, gKl] = room.makeAction('kill');
      sendPose = sp;
      sendChat = sc;
      sendRosterAnn = sra;
      sendRosterFull = srf;
      sendSession = sse;
      sendAliens = sa;
      sendShot = sSh;
      sendHit = sHt;
      sendKill = sKl;

      gse((msg, peerId) => {
        if (!msg || typeof msg !== 'object') return;
        for (const l of sessionListeners) l(msg, peerId);
      });
      ga((msg, peerId) => {
        if (!msg) return;
        for (const l of aliensListeners) l(msg, peerId);
      });
      gSh((msg, peerId) => {
        if (!msg) return;
        for (const l of shotListeners) l(msg, peerId);
      });
      gHt((msg, peerId) => {
        if (!msg) return;
        for (const l of hitListeners) l(msg, peerId);
      });
      gKl((msg, peerId) => {
        if (!msg) return;
        for (const l of killListeners) l(msg, peerId);
      });

      room.onPeerJoin(id => {
        peers.set(id, { renderX: 0, renderY: 0 });
        broadcastPose();
        recomputeHost();
        firePeers();
        for (const l of peerJoinListeners) l(id);
      });
      room.onPeerLeave(id => {
        const leaving = peers.get(id); // capture before delete
        for (const l of peerLeaveListeners) l(id, leaving);
        peers.delete(id);
        recomputeHost();
        firePeers();
      });

      gp((data, peerId) => {
        if (!data || typeof data !== 'object') return;
        const existing = peers.get(peerId);
        const entry = existing || {
          renderX: data.x ?? 0,
          renderY: data.y ?? 0,
        };
        Object.assign(entry, data);
        peers.set(peerId, entry);
      });

      gra((msg, peerId) => {
        if (!msg || typeof msg !== 'object') return;
        for (const l of rosterAnnListeners) l(msg, peerId);
      });

      grf((msg, peerId) => {
        if (!msg || typeof msg !== 'object') return;
        for (const l of rosterFullListeners) l(msg, peerId);
      });

      gc((msg, peerId) => {
        if (!msg || typeof msg !== 'object') return;
        const p = peers.get(peerId) || {};
        const text = String(msg.text || '').slice(0, 200);
        if (!text) return;
        const evt = {
          peerId,
          username: String(msg.username || p.username || 'unknown').slice(0, 24),
          color: String(msg.color || p.color || 'c8142b').slice(0, 8),
          text,
        };
        for (const l of chatListeners) l(evt);
      });

      status = 'connected';
      recomputeHost();
      fireStatus();
      firePeers();
    } catch (err) {
      console.error('[net] connect failed:', err);
      status = 'offline';
      fireStatus();
    }
  }

  function tick(dt) {
    broadcastAcc += dt;
    if (broadcastAcc >= 1 / BROADCAST_HZ) {
      broadcastAcc = 0;
      broadcastPose();
    }
    const k = Math.min(1, dt * 12);
    for (const p of peers.values()) {
      if (p.x == null) continue;
      p.renderX += (p.x - p.renderX) * k;
      p.renderY += (p.y - p.renderY) * k;
    }
  }

  function sendChatMessage(text, username, color) {
    const clean = String(text || '').trim().slice(0, 200);
    if (!clean) return;
    const payload = { text: clean, username, color, ts: Date.now() };
    if (sendChat) {
      try { sendChat(payload); } catch (e) { /* ignore */ }
    }
    for (const l of chatListeners) l({
      peerId: selfId, username, color, text: clean,
    });
  }

  addEventListener('beforeunload', () => {
    if (room) { try { room.leave(); } catch {} }
  });

  connect();

  return {
    get selfId() { return selfId; },
    get hostId() { return hostId; },
    get isHost() { return hostId != null && hostId === selfId; },
    get status() { return status; },
    get peers() { return peers; },
    tick,
    broadcastPose,
    sendChat: sendChatMessage,
    onChat(fn) { chatListeners.add(fn); return () => chatListeners.delete(fn); },
    onStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); },
    onPeerChange(fn) { peerListeners.add(fn); return () => peerListeners.delete(fn); },
    onHostChange(fn) { hostListeners.add(fn); return () => hostListeners.delete(fn); },
    onPeerJoin(fn) { peerJoinListeners.add(fn); return () => peerJoinListeners.delete(fn); },
    onPeerLeave(fn) { peerLeaveListeners.add(fn); return () => peerLeaveListeners.delete(fn); },
    onRosterAnn(fn) { rosterAnnListeners.add(fn); return () => rosterAnnListeners.delete(fn); },
    onRosterFull(fn) { rosterFullListeners.add(fn); return () => rosterFullListeners.delete(fn); },
    sendRosterAnn: (msg, target) => { if (sendRosterAnn) try { sendRosterAnn(msg, target); } catch {} },
    sendRosterFull: (msg, target) => { if (sendRosterFull) try { sendRosterFull(msg, target); } catch {} },
    sendSession: (msg, target) => { if (sendSession) try { sendSession(msg, target); } catch {} },
    onSession(fn) { sessionListeners.add(fn); return () => sessionListeners.delete(fn); },
    sendAliens: (msg, target) => { if (sendAliens) try { sendAliens(msg, target); } catch {} },
    onAliens(fn) { aliensListeners.add(fn); return () => aliensListeners.delete(fn); },
    sendShot: (msg, target) => { if (sendShot) try { sendShot(msg, target); } catch {} },
    onShot(fn) { shotListeners.add(fn); return () => shotListeners.delete(fn); },
    sendHit: (msg, target) => { if (sendHit) try { sendHit(msg, target); } catch {} },
    onHit(fn) { hitListeners.add(fn); return () => hitListeners.delete(fn); },
    sendKill: (msg, target) => { if (sendKill) try { sendKill(msg, target); } catch {} },
    onKill(fn) { killListeners.add(fn); return () => killListeners.delete(fn); },
  };
}
