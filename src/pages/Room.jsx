import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Peer from 'peerjs';
import data from '../data/recipes.json';
import '../styles/main.css';

/* ─── TURN servers ────────────────────────────────────────────────────────────
   Using Metered.ca documented demo credentials + multiple fallbacks.
   iceTransportPolicy: 'all' — direct P2P on same network, TURN on different.
───────────────────────────────────────────────────────────────────────────── */
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  // Metered.ca TURN — documented public demo credentials
  { urls: 'turn:a.relay.metered.ca:80',    username: '83eebabf8b4cce9d5dbcb649', credential: '2D7JvfkOQtBdYW3R' },
  { urls: 'turn:a.relay.metered.ca:80?transport=tcp', username: '83eebabf8b4cce9d5dbcb649', credential: '2D7JvfkOQtBdYW3R' },
  { urls: 'turn:a.relay.metered.ca:443',   username: '83eebabf8b4cce9d5dbcb649', credential: '2D7JvfkOQtBdYW3R' },
  { urls: 'turns:a.relay.metered.ca:443',  username: '83eebabf8b4cce9d5dbcb649', credential: '2D7JvfkOQtBdYW3R' },
  // openrelay backup
  { urls: 'turn:openrelay.metered.ca:80',   username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443',  username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
];


useEffect(() => {
  if (localVideoRef.current) {
    localVideoRef.current.muted = true;
    localVideoRef.current.volume = 0;
    localVideoRef.current.setAttribute("muted", "");
  }
}, []);
/* ─── getUserMedia error classifier ──────────────────────────────────────── */
function classifyError(err) {
  const name = err?.name || '';
  const msg  = (err?.message || '').toLowerCase();
  if (name === 'NotAllowedError'  || name === 'PermissionDeniedError') return 'permission';
  if (name === 'NotFoundError'    || name === 'DevicesNotFoundError')   return 'not-found';
  if (name === 'NotReadableError' || name === 'TrackStartError')        return 'in-use';
  if (msg.includes('permission'))  return 'permission';
  if (msg.includes('not found'))   return 'not-found';
  return 'unknown';
}

/* ─── Request mic + camera separately (iOS shows one prompt at a time) ──── */
async function getBestStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { stream: null, mode: 'blocked', warning: 'Camera/mic requires HTTPS.' };
  }
  let audioStream = null;
  let videoStream = null;
  let audioWarn = '', videoWarn = '';

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (e) {
    const k = classifyError(e);
    audioWarn = k === 'permission' ? 'Mic denied. Tap 🔒 → Allow.' : 'No mic detected.';
  }

  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  } catch (e) {
    const k = classifyError(e);
    videoWarn = k === 'permission' ? 'Camera denied. Tap 🔒 → Allow.' : 'No camera detected.';
  }

  const hasAudio = !!audioStream?.getAudioTracks().length;
  const hasVideo = !!videoStream?.getVideoTracks().length;

  if (!hasAudio && !hasVideo) {
    return { stream: new MediaStream(), mode: 'no-device', warning: `${audioWarn} ${videoWarn}`.trim() };
  }

  const merged = new MediaStream();
  if (hasAudio) audioStream.getAudioTracks().forEach(t => merged.addTrack(t));
  if (hasVideo) videoStream.getVideoTracks().forEach(t => merged.addTrack(t));

  const mode    = hasAudio && hasVideo ? 'video+audio' : hasAudio ? 'audio-only' : 'video-only';
  const warning = !hasAudio ? audioWarn : !hasVideo ? videoWarn : '';
  return { stream: merged, mode, warning };
}

/* ─── Recipe panel ─────────────────────────────────────────────────────────── */
function RecipePanel({ recipe }) {
  const [tab, setTab]         = useState('ingredients');
  const [checked, setChecked] = useState({});
  if (!recipe) return (
    <aside className="room-recipe-panel room-recipe-panel--empty">
      <div className="room-recipe-panel__empty-icon">🍽️</div>
      <p>No recipe loaded.<br />Open a recipe and click<br /><strong>Make With Friend</strong>.</p>
    </aside>
  );
  const toggle    = i => setChecked(p => ({ ...p, [i]: !p[i] }));
  const doneCount = Object.values(checked).filter(Boolean).length;
  return (
    <aside className="room-recipe-panel">
      <div className="room-recipe-panel__header">
        <img src={recipe.image} alt={recipe.title} className="room-recipe-panel__img" />
        <div className="room-recipe-panel__meta-row">
          <span>⏱ {recipe.time}</span><span>👤 {recipe.servings}</span><span>📊 {recipe.difficulty}</span>
        </div>
        <h2 className="room-recipe-panel__title">{recipe.title}</h2>
      </div>
      <div className="room-recipe-panel__tabs">
        <button className={`room-tab ${tab === 'ingredients' ? 'active' : ''}`} onClick={() => setTab('ingredients')}>
          Ingredients <span className="room-tab__count">{recipe.ingredients.length}</span>
        </button>
        <button className={`room-tab ${tab === 'steps' ? 'active' : ''}`} onClick={() => setTab('steps')}>
          Steps <span className={`room-tab__count ${doneCount > 0 ? 'room-tab__count--done' : ''}`}>
            {doneCount > 0 ? `${doneCount}/${recipe.instructions.length}` : recipe.instructions.length}
          </span>
        </button>
      </div>
      <div className="room-recipe-panel__content">
        {tab === 'ingredients' && (
          <ul className="room-ingredients">
            {recipe.ingredients.map((item, i) => (
              <li key={i} className="room-ingredient-item"><span className="room-ingredient-dot" />{item}</li>
            ))}
          </ul>
        )}
        {tab === 'steps' && (
          <>
            {doneCount > 0 && <div className="room-progress"><div className="room-progress__bar" style={{ width: `${(doneCount / recipe.instructions.length) * 100}%` }} /></div>}
            <p className="room-steps-hint">Tap a step to mark it done ✓</p>
            <ol className="room-steps">
              {recipe.instructions.map((step, i) => (
                <li key={i} className={`room-step ${checked[i] ? 'done' : ''}`} onClick={() => toggle(i)}>
                  <span className="room-step__num">{checked[i] ? '✓' : i + 1}</span>
                  <p className="room-step__text">{step}</p>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </aside>
  );
}

/* ─── Lobby ────────────────────────────────────────────────────────────────── */
function Lobby({ recipe, roomId, onJoin }) {
  const [joining,  setJoining]  = useState(false);
  const [lobbyErr, setLobbyErr] = useState('');

  const handleJoin = async () => {
    setJoining(true);
    setLobbyErr('');
    const result = await getBestStream();
    if (result.mode === 'blocked') {
      setLobbyErr(result.warning);
      setJoining(false);
      return;
    }
    onJoin(result);
  };

  return (
    <div className="room-lobby">
      <div className="room-lobby__card">
        <div className="room-lobby__logo">Flavour<span>Kit</span> · Live</div>
        {recipe ? (
          <div className="room-lobby__recipe">
            <img src={recipe.image} alt={recipe.title} className="room-lobby__recipe-img" />
            <p className="room-lobby__recipe-name">{recipe.title}</p>
          </div>
        ) : <div className="room-lobby__recipe-empty">🍳</div>}
        <h2 className="room-lobby__title">Ready to cook together?</h2>
        <p className="room-lobby__subtitle">
          Room <code className="room-lobby__code">{roomId}</code><br />
          Allow camera &amp; microphone when asked.
        </p>
        {lobbyErr && <div className="room-lobby__error"><span>⚠️</span><span>{lobbyErr}</span></div>}
        <button className="room-lobby__join-btn" onClick={handleJoin} disabled={joining}>
          {joining ? '📷 Starting camera…' : '🎥 Join Call'}
        </button>
        <p className="room-lobby__hint">Tap Join — browser will ask for permission once.</p>
      </div>
    </div>
  );
}

/* ─── Debug panel (visible on screen — helps diagnose mobile issues) ────────── */
function DebugPanel({ logs, visible, onToggle }) {
  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999 }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', padding: '6px', background: '#1a1a1a',
          color: '#888', border: 'none', fontSize: '0.7rem', cursor: 'pointer',
          borderTop: '1px solid #333',
        }}
      >
        {visible ? '▼ Hide Debug' : '▲ Show Debug Log'}
      </button>
      {visible && (
        <div style={{
          background: '#0a0a0a', color: '#0f0', fontFamily: 'monospace',
          fontSize: '0.65rem', padding: '8px', maxHeight: '180px',
          overflowY: 'auto', borderTop: '1px solid #333',
        }}>
          {logs.map((l, i) => <div key={i}>{l}</div>)}
          {logs.length === 0 && <div>No logs yet.</div>}
        </div>
      )}
    </div>
  );
}

/* ─── Main Room ────────────────────────────────────────────────────────────── */
export default function Room() {
  const { id: roomId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();

  const localVideoRef   = useRef(null);
  const remoteVideoRef  = useRef(null);
  const peerRef         = useRef(null);
  const localStreamRef  = useRef(null);
  const remoteStreamRef = useRef(null);
  const dataConnRef     = useRef(null);
  const activeCallRef   = useRef(null);
  const streamRetryRef  = useRef(null);

  const [phase,        setPhase]        = useState('lobby');
  const [connected,    setConnected]    = useState(false);
  const [waiting,      setWaiting]      = useState(true);
  const [copied,       setCopied]       = useState(false);
  const [mediaMode,    setMediaMode]    = useState('');
  const [mediaWarning, setMediaWarning] = useState('');
  const [micOn,        setMicOn]        = useState(true);
  const [camOn,        setCamOn]        = useState(true);
  const [remoteMicOff, setRemoteMicOff] = useState(false);
  const [remoteCamOff, setRemoteCamOff] = useState(false);
  const [iceState,     setIceState]     = useState('');
  const [connStatus,   setConnStatus]   = useState('');
  const [audioMuted,   setAudioMuted]   = useState(false);
  const [debugLogs,    setDebugLogs]    = useState([]);
  const [showDebug,    setShowDebug]    = useState(false);

  const recipeId   = searchParams.get('recipe');
  const recipe     = recipeId ? data.recipes.find(r => r.id === recipeId) : null;
  const inviteLink = `${window.location.origin}/room/${roomId}${recipeId ? `?recipe=${recipeId}` : ''}`;

  const log = useCallback((msg) => {
    const ts = new Date().toLocaleTimeString();
    setDebugLogs(prev => [`[${ts}] ${msg}`, ...prev].slice(0, 60));
  }, []);

  const sendMediaState = useCallback((mic, cam) => {
    const conn = dataConnRef.current;
    if (conn?.open) conn.send({ type: 'mediaState', micOn: mic, camOn: cam });
  }, []);

  const wireDataConn = useCallback((conn) => {
    dataConnRef.current = conn;
    log('DataConn received');
    conn.on('data', msg => {
      if (msg?.type === 'mediaState') {
        setRemoteMicOff(!msg.micOn);
        setRemoteCamOff(!msg.camOn);
      }
    });
    conn.on('open', () => {
      log('DataConn open — sending media state');
      sendMediaState(micOn, camOn);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendMediaState, log]);

  /* Retry attaching stream every 500ms until video plays */
  const startStreamRetry = useCallback((remoteStream) => {
    clearInterval(streamRetryRef.current);
    let attempts = 0;
    streamRetryRef.current = setInterval(() => {
      const el = remoteVideoRef.current;
      if (!el) return;
      if (el.srcObject !== remoteStream) {
        el.srcObject = remoteStream;
        el.muted = false;
        el.volume = 1.0;
        log(`Stream attach attempt ${attempts + 1}`);
      }
      if (el.paused) {
        el.play().then(() => {
          log('play() succeeded');
          // Check if audio is actually playing
          setTimeout(() => {
            if (el.muted || el.volume === 0) {
              log('Audio appears muted — showing unmute button');
              setAudioMuted(true);
            } else {
              setAudioMuted(false);
            }
          }, 500);
          clearInterval(streamRetryRef.current);
        }).catch(e => {
          log(`play() failed: ${e.name} — showing unmute button`);
          setAudioMuted(true);
        });
      } else {
        // Video is playing — verify audio isn't muted
        if (el.muted) {
          el.muted = false;
          el.volume = 1.0;
          log('Forced unmute on playing video');
        }
        log(`Video playing on attempt ${attempts + 1}`);
        clearInterval(streamRetryRef.current);
      }
      if (++attempts >= 10) {
        log('Max stream attach attempts reached');
        clearInterval(streamRetryRef.current);
      }
    }, 500);
  }, [log]);

  /* ── Pending stream queue — holds stream until ICE confirms connection ── */
  const pendingStreamRef = useRef(null);

  /* Attach the remote stream now that ICE is confirmed connected */
  const flushPendingStream = useCallback(() => {
    const stream = pendingStreamRef.current;
    if (!stream) return;
    if (remoteStreamRef.current?.id === stream.id) return; // already attached
    log(`Flushing queued stream — id: ${stream.id}`);


if (stream.id === localStreamRef.current?.id) {
  log('Prevented attaching local stream as remote');
  return;
}
remoteStreamRef.current = stream;
    pendingStreamRef.current = null;
    startStreamRetry(stream);
    setConnected(true);
    setWaiting(false);
    setConnStatus('');
  }, [log, startStreamRetry]);

  const onRemoteStream = useCallback((remoteStream) => {
    log(`onRemoteStream fired — id: ${remoteStream.id}, tracks: ${remoteStream.getTracks().length}`);

    // Reject echo of our own stream

const local = localStreamRef.current;

if (local) {
  const localAudio = local.getAudioTracks()[0]?.id;
  const remoteAudio = remoteStream.getAudioTracks()[0]?.id;

  if (localAudio && remoteAudio && localAudio === remoteAudio) {
    log('Rejected: local audio echo detected');
    return;
  }
}
    // Deduplicate
    if (remoteStreamRef.current?.id === remoteStream.id) { log('Deduplicated'); return; }
    if (pendingStreamRef.current?.id === remoteStream.id) { log('Already queued'); return; }

    log(`Audio: ${remoteStream.getAudioTracks().length}, Video: ${remoteStream.getVideoTracks().length}`);

    // Queue the stream — only attach once ICE confirms a real connection
    // This prevents showing a blank/local stream before P2P is established
    pendingStreamRef.current = remoteStream;
    log('Stream queued — waiting for ICE connected state');
  }, [log]);

  const monitorIce = useCallback((call) => {
    const pc = call?.peerConnection;
    if (!pc) { log('No peerConnection'); return; }
    let disconnectTimer = null;

    const update = () => {
      const s = pc.iceConnectionState;
      const g = pc.iceGatheringState;
      log(`ICE: ${s} | gathering: ${g}`);
      clearTimeout(disconnectTimer);

      if (s === 'connected' || s === 'completed') {
        setIceState('');
        log('ICE connected — flushing pending stream');
        flushPendingStream(); // ← attach stream now that we have a real connection
        return;
      }
      if (s === 'disconnected') {
        disconnectTimer = setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected') {
            setIceState('disconnected');
            try { pc.restartIce(); log('ICE restart'); } catch (_) {}
          }
        }, 4000);
        return;
      }
      if (s === 'failed') {
        setIceState('failed');
        log('ICE FAILED — restarting');
        try { pc.restartIce(); } catch (_) {}
        return;
      }
      setIceState(s === 'new' || s === 'checking' ? 'checking' : s);
    };

    pc.oniceconnectionstatechange = update;
    pc.onicegatheringstatechange  = () => log(`Gathering: ${pc.iceGatheringState}`);
    pc.onconnectionstatechange    = () => {
      log(`Connection state: ${pc.connectionState}`);
      // connectionState 'connected' is more reliable on some browsers
      if (pc.connectionState === 'connected') {
        setIceState('');
        flushPendingStream();
      }
    };
    pc.onsignalingstatechange = () => log(`Signaling: ${pc.signalingState}`);
   pc.onicecandidate = e => {
  if (!e.candidate) {
    log('ICE gathering complete');
    return;
  }

  if (e.candidate.type === "relay") {
    log("Using TURN relay server");
  }
};

    update();
  }, [log, flushPendingStream]);

  const startCall = useCallback(({ stream, mode, warning }) => {
    localStreamRef.current = stream;
    setMediaMode(mode);
    setMediaWarning(warning || '');
    setPhase('call');
    log(`Call started — mode: ${mode}`);

    // Attach local video with retry
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (stream?.getVideoTracks().length > 0) {
if (localVideoRef.current) {
  localVideoRef.current.muted = true;
  localVideoRef.current.volume = 0;
}
        log('Local video attached');
      }
    }));

    const hostPeerId = `flavourkit2-host-${roomId}`;
    const peerConfig = {
      config: {
        iceServers: ICE_SERVERS,
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      },
    };

    const safeStream = stream || new MediaStream();
    log(`SafeStream tracks: ${safeStream.getTracks().length}`);

  const onCallClose = () => {

  log('Call closed');

  clearInterval(streamRetryRef.current);

  pendingStreamRef.current = null;
  remoteStreamRef.current = null;

  if (remoteVideoRef.current) {
    remoteVideoRef.current.srcObject = null;
  }

  setConnected(false);
  setWaiting(true);
  setRemoteMicOff(false);
  setRemoteCamOff(false);
  setIceState('');
};

    setConnStatus('Connecting…');
    log(`Registering as host: ${hostPeerId}`);

    const hostPeer = new Peer(hostPeerId, peerConfig);
    peerRef.current = hostPeer;

    hostPeer.on('open', id => {
      log(`Host peer open: ${id}`);
      setWaiting(true);
      setConnStatus('Waiting for friend…');
      hostPeer.on('connection', conn => wireDataConn(conn));
    });

    hostPeer.on('call', call => {
      log('Incoming call — answering');
      activeCallRef.current = call;
      setConnStatus('Friend joining…');
      call.answer(safeStream);
      monitorIce(call);
      call.on('stream', onRemoteStream);
      call.on('close',  onCallClose);
    });

  hostPeer.destroy();

const guestPeer = new Peer(undefined, peerConfig);
peerRef.current = guestPeer;

guestPeer.on('open', id => {
  log(`Guest peer open: ${id} — calling host: ${hostPeerId}`);

  setConnStatus('Calling host…');

  const call = guestPeer.call(hostPeerId, safeStream);

  activeCallRef.current = call;

  monitorIce(call);

  call.on('stream', onRemoteStream);
  call.on('close', onCallClose);

  const tryData = (n = 0) => {
    const conn = guestPeer.connect(hostPeerId, { reliable: true });

    conn.on('open', () => wireDataConn(conn));

    conn.on('error', () => {
      log(`DataConn attempt ${n} failed`);
      if (n < 5) setTimeout(() => tryData(n + 1), 800);
    });
  };

  setTimeout(() => tryData(), 500);
});
  }, [roomId, wireDataConn, monitorIce, onRemoteStream, log, startStreamRetry]);

  useEffect(() => {
    return () => {
      clearInterval(streamRetryRef.current);
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      if (peerRef.current)        peerRef.current.destroy();
    };
  }, []);

  const tapToUnmute = () => {
    const el = remoteVideoRef.current;
    if (!el) return;
    el.muted = false;
    el.volume = 1.0;
    el.play().then(() => {
      setAudioMuted(false);
      log('Unmuted by user tap');
    }).catch(e => log(`tapToUnmute play() failed: ${e.name}`));
  };

  const copyInviteLink = async () => {
    try { await navigator.clipboard.writeText(inviteLink); }
    catch {
      const el = document.createElement('textarea');
      el.value = inviteLink; document.body.appendChild(el);
      el.select(); document.execCommand('copy'); document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const toggleMic = () => {
    if (!localStreamRef.current) return;
    const next = !micOn;
    localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = next; });
    setMicOn(next); sendMediaState(next, camOn);
    log(`Mic ${next ? 'on' : 'off'}`);
  };

  const toggleCam = () => {
    if (!localStreamRef.current) return;
    const next = !camOn;
    localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = next; });
    setCamOn(next); sendMediaState(micOn, next);
    log(`Cam ${next ? 'on' : 'off'}`);
  };

  const endCall = () => {
    clearInterval(streamRetryRef.current);
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    if (peerRef.current)        peerRef.current.destroy();
    navigate(-1);
  };

  const hasLocalVideo = mediaMode === 'video+audio' || mediaMode === 'video-only';

  if (phase === 'lobby') {
    return <Lobby recipe={recipe} roomId={roomId} onJoin={startCall} />;
  }

  const iceColor = { checking: '#f59e0b', disconnected: '#f97316', failed: '#ef4444' };

  return (
    <div className="room-page" style={{ paddingBottom: showDebug ? 220 : 44 }}>
      <nav className="room-nav">
        <div className="room-nav__logo">Flavour<span>Kit</span> · Live</div>
        <div className="room-nav__center">
          <div className={`status-dot ${waiting ? 'waiting' : ''}`} />
          <span className="status-text">
            {connected ? '🎉 Connected!'
              : connStatus || (waiting ? 'Waiting for friend…' : 'Connecting…')}
          </span>
        </div>
        <div className="room-nav__id">{roomId}</div>
      </nav>

      <div className="room-layout">
        <div className="room-call-col">
          {mediaWarning && (
            <div className="room-media-warning">
              <span>⚠️</span>
              <span style={{ flex: 1 }}>{mediaWarning}</span>
              <button className="room-retry-btn" onClick={() => setPhase('lobby')}>Retry</button>
            </div>
          )}

          {iceState && iceColor[iceState] && (
            <div style={{
              background: 'rgba(0,0,0,0.5)', border: `1px solid ${iceColor[iceState]}`,
              borderRadius: 8, padding: '8px 14px', fontSize: '0.8rem',
              color: iceColor[iceState], marginBottom: 8,
            }}>
              {iceState === 'checking'     && '🔄 Establishing connection…'}
              {iceState === 'disconnected' && '⚠️ Link unstable — trying to recover…'}
              {iceState === 'failed'       && '❌ Connection failed — tap End Call and rejoin'}
            </div>
          )}

          <div className="room-videos">
            {/* YOUR VIDEO */}
            <div className="video-container">
              <video ref={localVideoRef} autoPlay muted playsInline className="room-video-el"
                style={{ transform: 'scaleX(-1)', display: (hasLocalVideo && camOn) ? 'block' : 'none' }} />
              {(!hasLocalVideo || !camOn) && (
                <div className="video-placeholder">
                  <div className="video-placeholder__icon">
                    {!hasLocalVideo ? (mediaMode === 'audio-only' ? '🎙️' : '📵') : '🚫'}
                  </div>
                  <div className="video-placeholder__text">
                    {!hasLocalVideo ? (mediaMode === 'audio-only' ? 'Audio only' : 'No camera') : 'Camera off'}
                  </div>
                </div>
              )}
              <div className="video-status-bar">
                <span className={`vstatus-icon ${!micOn ? 'vstatus-icon--off' : ''}`}>{micOn ? '🎙️' : '🔇'}</span>
                {hasLocalVideo && <span className={`vstatus-icon ${!camOn ? 'vstatus-icon--off' : ''}`}>{camOn ? '📷' : '🚫'}</span>}
              </div>
              <span className="video-container__label">You</span>
            </div>

            {/* FRIEND'S VIDEO */}
            <div className="video-container">
              <video ref={remoteVideoRef} autoPlay playsInline className="room-video-el"
                style={{ display: connected ? 'block' : 'none' }} />
              {!connected && (
                <div className="video-placeholder">
                  <div className="video-placeholder__icon">👨‍🍳</div>
                  <div className="video-placeholder__text">
                    {waiting ? 'Waiting for friend…' : 'Connecting…'}
                  </div>
                </div>
              )}
              {connected && remoteCamOff && (
                <div className="video-cam-off-overlay">
                  <div className="video-placeholder__icon">🚫</div>
                  <div className="video-placeholder__text">Camera off</div>
                </div>
              )}
              {/* Tap to unmute — shown when mobile browser blocks audio autoplay */}
              {connected && audioMuted && (
                <div className="video-unmute-overlay" onClick={tapToUnmute}>
                  <div style={{ fontSize: '2rem' }}>🔇</div>
                  <div style={{
                    background: 'var(--pink)', color: 'white',
                    padding: '8px 20px', borderRadius: 20,
                    fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-body)',
                    marginTop: 8,
                  }}>
                    Tap to hear audio
                  </div>
                </div>
              )}
              {connected && (
                <div className="video-status-bar">
                  <span className={`vstatus-icon ${remoteMicOff ? 'vstatus-icon--off' : ''}`}>{remoteMicOff ? '🔇' : '🎙️'}</span>
                  <span className={`vstatus-icon ${remoteCamOff ? 'vstatus-icon--off' : ''}`}>{remoteCamOff ? '🚫' : '📷'}</span>
                </div>
              )}
              {connected && <span className="video-container__label">Friend 🧑‍🍳</span>}
            </div>
          </div>

          <div className="room-controls">
            <button className={`media-toggle-btn ${!micOn ? 'off' : ''}`} onClick={toggleMic}>
              {micOn ? '🎙️' : '🔇'} <span>{micOn ? 'Mute' : 'Unmute'}</span>
            </button>
            {hasLocalVideo && (
              <button className={`media-toggle-btn ${!camOn ? 'off' : ''}`} onClick={toggleCam}>
                {camOn ? '📷' : '🚫'} <span>{camOn ? 'Cam off' : 'Cam on'}</span>
              </button>
            )}
            <div className="room-controls-divider" />
            <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={copyInviteLink}>
              {copied ? '✓ Copied!' : '🔗 Copy Link'}
            </button>
            <button className="end-btn" onClick={endCall}>✕ End</button>
          </div>
        </div>

        <RecipePanel recipe={recipe} />
      </div>

      <DebugPanel logs={debugLogs} visible={showDebug} onToggle={() => setShowDebug(v => !v)} />
    </div>
  );
}
