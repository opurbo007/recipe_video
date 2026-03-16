import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Peer from 'peerjs';
import data from '../data/recipes.json';

/* ─── Error classifier ────────────────────────────────────────────────────── */
function classifyError(err) {
  const name = err?.name || '';
  const msg  = (err?.message || '').toLowerCase();
  if (name === 'NotAllowedError'  || name === 'PermissionDeniedError') return 'permission';
  if (name === 'NotFoundError'    || name === 'DevicesNotFoundError')   return 'not-found';
  if (name === 'NotReadableError' || name === 'TrackStartError')        return 'in-use';
  if (name === 'OverconstrainedError')                                  return 'not-found';
  if (msg.includes('permission'))                                       return 'permission';
  if (msg.includes('not found') || msg.includes('no device'))          return 'not-found';
  return 'unknown';
}

/* ─── Best available media stream ─────────────────────────────────────────── */
async function getBestStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { stream: null, mode: 'blocked', warning: 'Camera/microphone requires HTTPS. Open the site over https://' };
  }
  let lastErr = null;

  // 1) video + audio
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    return { stream, mode: 'video+audio', warning: '' };
  } catch (e) { lastErr = e; }

  const k1 = classifyError(lastErr);
  if (k1 === 'permission') return { stream: null, mode: 'blocked', warning: 'Camera & microphone access was denied. Tap the 🔒 icon in the address bar, set both to Allow, then tap Retry.' };
  if (k1 === 'in-use')     return { stream: null, mode: 'blocked', warning: 'Camera is in use by another app. Close it then tap Retry.' };

  // 2) audio only
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
    return { stream, mode: 'audio-only', warning: 'No camera found — joining with audio only.' };
  } catch (e) { lastErr = e; }

  const k2 = classifyError(lastErr);
  if (k2 === 'permission') return { stream: null, mode: 'blocked', warning: 'Microphone access was denied. Tap the 🔒 icon, set Microphone to Allow, then tap Retry.' };

  // 3) silent fallback so PeerJS can still connect
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const dest = ctx.createMediaStreamDestination();
    return { stream: dest.stream, mode: 'no-device', ctx, warning: 'No camera or microphone detected.' };
  } catch (_) {}

  return { stream: null, mode: 'error', warning: 'Could not access any media device.' };
}

/* ─── Recipe side panel ───────────────────────────────────────────────────── */
function RecipePanel({ recipe }) {
  const [tab, setTab]         = useState('ingredients');
  const [checked, setChecked] = useState({});
  if (!recipe) return (
    <aside className="room-recipe-panel room-recipe-panel--empty">
      <div className="room-recipe-panel__empty-icon">🍽️</div>
      <p>No recipe loaded.<br />Open a recipe and click<br /><strong>Make With Friend</strong>.</p>
    </aside>
  );
  const toggle    = (i) => setChecked(p => ({ ...p, [i]: !p[i] }));
  const doneCount = Object.values(checked).filter(Boolean).length;
  return (
    <aside className="room-recipe-panel">
      <div className="room-recipe-panel__header">
        <img src={recipe.image} alt={recipe.title} className="room-recipe-panel__img" />
        <div className="room-recipe-panel__meta-row">
          <span>⏱ {recipe.time}</span>
          <span>👤 {recipe.servings}</span>
          <span>📊 {recipe.difficulty}</span>
        </div>
        <h2 className="room-recipe-panel__title">{recipe.title}</h2>
      </div>
      <div className="room-recipe-panel__tabs">
        <button className={`room-tab ${tab === 'ingredients' ? 'active' : ''}`} onClick={() => setTab('ingredients')}>
          Ingredients <span className="room-tab__count">{recipe.ingredients.length}</span>
        </button>
        <button className={`room-tab ${tab === 'steps' ? 'active' : ''}`} onClick={() => setTab('steps')}>
          Steps{' '}
          <span className={`room-tab__count ${doneCount > 0 ? 'room-tab__count--done' : ''}`}>
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
            {doneCount > 0 && (
              <div className="room-progress">
                <div className="room-progress__bar" style={{ width: `${(doneCount / recipe.instructions.length) * 100}%` }} />
              </div>
            )}
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

/* ─── Lobby (pre-join) screen ─────────────────────────────────────────────── */
/*
  WHY THIS EXISTS:
  iOS Safari and Android Chrome enforce that getUserMedia() MUST be called
  inside a synchronous user-gesture handler (tap / click).
  Calling it automatically in useEffect is treated as a non-gesture context
  and either silently fails, loops permission prompts, or produces no stream.

  The lobby shows a "Join Call" button. The user taps it → the onClick handler
  calls getBestStream() synchronously → browser accepts it as a user gesture
  → permission prompt appears exactly once → stream is granted.
*/
function Lobby({ recipe, roomId, onJoin }) {
  const [joining,  setJoining]  = useState(false);
  const [lobbyErr, setLobbyErr] = useState('');

  const handleJoin = async () => {
    setJoining(true);
    setLobbyErr('');
    // Called directly inside a click handler — satisfies mobile gesture requirement
    const result = await getBestStream();
    if (result.mode === 'blocked' || result.mode === 'error') {
      setLobbyErr(result.warning);
      setJoining(false);
      return;
    }
    onJoin(result); // hand stream + mode + warning up to Room
  };

  return (
    <div className="room-lobby">
      <div className="room-lobby__card">
        {/* Logo */}
        <div className="room-lobby__logo">Flavour<span>Kit</span> · Live</div>

        {/* Recipe preview */}
        {recipe ? (
          <div className="room-lobby__recipe">
            <img src={recipe.image} alt={recipe.title} className="room-lobby__recipe-img" />
            <p className="room-lobby__recipe-name">{recipe.title}</p>
          </div>
        ) : (
          <div className="room-lobby__recipe-empty">🍳</div>
        )}

        <h2 className="room-lobby__title">Ready to cook together?</h2>
        <p className="room-lobby__subtitle">
          Room <code className="room-lobby__code">{roomId}</code>
          <br />Your browser will ask for camera &amp; microphone access.
        </p>

        {lobbyErr && (
          <div className="room-lobby__error">
            <span>⚠️</span>
            <span>{lobbyErr}</span>
          </div>
        )}

        <button
          className="room-lobby__join-btn"
          onClick={handleJoin}
          disabled={joining}
        >
          {joining ? '⏳ Starting camera…' : '🎥 Join Call'}
        </button>

        <p className="room-lobby__hint">
          Tap the button above — your browser will ask permission once.
        </p>
      </div>
    </div>
  );
}

/* ─── Main Room ───────────────────────────────────────────────────────────── */
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

  // Phase: 'lobby' → user must tap Join first  |  'call' → live call
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

  const recipeId   = searchParams.get('recipe');
  const recipe     = recipeId ? data.recipes.find(r => r.id === recipeId) : null;
  const inviteLink = `${window.location.origin}/room/${roomId}${recipeId ? `?recipe=${recipeId}` : ''}`;

  /* Send media state over DataConnection */
  const sendMediaState = useCallback((mic, cam) => {
    const conn = dataConnRef.current;
    if (conn?.open) conn.send({ type: 'mediaState', micOn: mic, camOn: cam });
  }, []);

  /* Wire a DataConnection */
  const wireDataConn = useCallback((conn) => {
    dataConnRef.current = conn;
    conn.on('data', (msg) => {
      if (msg?.type === 'mediaState') {
        setRemoteMicOff(!msg.micOn);
        setRemoteCamOff(!msg.camOn);
      }
    });
    conn.on('open', () => {
      // Send our current state as soon as the channel opens
      sendMediaState(micOn, camOn);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendMediaState]);

  /* Called by Lobby when the user taps Join and stream is ready */
  const startCall = useCallback(({ stream, mode, warning, ctx }) => {
    localStreamRef.current = stream;
    setMediaMode(mode);
    setMediaWarning(warning || '');
    setPhase('call');

    // Wire local video immediately — element is in DOM since phase is about to switch
    // Use a small timeout to let React render the call UI first
    setTimeout(() => {
      if (stream && localVideoRef.current && stream.getVideoTracks().length > 0) {
        localVideoRef.current.srcObject = stream;
      }
    }, 50);

    const hostPeerId = `recipetogether-host-${roomId}`;
    const peerConfig = {
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] },
    };
    const safeStream = stream || new MediaStream();

    const onRemoteStream = (remoteStream) => {
      // Guard against PeerJS echo (local stream reflected back)
      const local = localStreamRef.current;
      if (local) {
        if (remoteStream.id === local.id) return;
        const localIds = new Set(local.getTracks().map(t => t.id));
        if (remoteStream.getTracks().length > 0 && remoteStream.getTracks().every(t => localIds.has(t.id))) return;
      }
      remoteStreamRef.current = remoteStream;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
      setConnected(true);
      setWaiting(false);
    };

    const onCallClose = () => {
      remoteStreamRef.current = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      setConnected(false);
      setWaiting(true);
      setRemoteMicOff(false);
      setRemoteCamOff(false);
    };

    /* Try host first */
    const hostPeer = new Peer(hostPeerId, peerConfig);
    peerRef.current = hostPeer;

    hostPeer.on('open', () => {
      setWaiting(true);
      hostPeer.on('connection', (conn) => wireDataConn(conn));
    });

    hostPeer.on('call', (call) => {
      call.answer(safeStream);
      call.on('stream', onRemoteStream);
      call.on('close',  onCallClose);
    });

    hostPeer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        /* Become guest */
        hostPeer.destroy();
        const guestPeer = new Peer(peerConfig);
        peerRef.current = guestPeer;

        guestPeer.on('open', () => {
          const call = guestPeer.call(hostPeerId, safeStream);
          call.on('stream', onRemoteStream);
          call.on('close',  onCallClose);

          // Open data channel to host
          const tryData = (attempts = 0) => {
            const conn = guestPeer.connect(hostPeerId, { reliable: true });
            conn.on('open', () => wireDataConn(conn));
            conn.on('error', () => {
              if (attempts < 5) setTimeout(() => tryData(attempts + 1), 800);
            });
          };
          setTimeout(() => tryData(), 500);
        });

        guestPeer.on('error', () => {});
      }
    });

    // Store ctx for cleanup
    if (ctx) peerRef._cleanupCtx = ctx;
  }, [roomId, wireDataConn]);

  /* Cleanup on unmount */
  useEffect(() => {
    return () => {
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      if (peerRef.current)        peerRef.current.destroy();
      if (peerRef._cleanupCtx)    peerRef._cleanupCtx.close();
    };
  }, []);

  /* Controls */
  const copyInviteLink = async () => {
    try { await navigator.clipboard.writeText(inviteLink); }
    catch {
      const el = document.createElement('textarea');
      el.value = inviteLink;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const toggleMic = () => {
    if (!localStreamRef.current) return;
    const next = !micOn;
    localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = next; });
    setMicOn(next);
    sendMediaState(next, camOn);
  };

  const toggleCam = () => {
    if (!localStreamRef.current) return;
    const next = !camOn;
    localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = next; });
    setCamOn(next);
    sendMediaState(micOn, next);
  };

  const endCall = () => {
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    if (peerRef.current)        peerRef.current.destroy();
    navigate(-1);
  };

  const hasLocalVideo = mediaMode === 'video+audio';

  /* ── Show lobby until the user taps Join ── */
  if (phase === 'lobby') {
    return <Lobby recipe={recipe} roomId={roomId} onJoin={startCall} />;
  }

  /* ── Live call UI ── */
  return (
    <div className="room-page">
      <nav className="room-nav">
        <div className="room-nav__logo">Flavour<span>Kit</span> · Live</div>
        <div className="room-nav__center">
          <div className={`status-dot ${waiting ? 'waiting' : ''}`} />
          <span className="status-text">
            {connected ? '🎉 Friend connected — cook away!'
              : waiting ? 'Waiting for friend to join…'
              : 'Connecting…'}
          </span>
        </div>
        <div className="room-nav__id">Room: {roomId}</div>
      </nav>

      <div className="room-layout">
        {/* ── LEFT: Video ── */}
        <div className="room-call-col">
          {mediaWarning && (
            <div className={`room-media-warning ${mediaMode === 'blocked' ? 'room-media-warning--blocked' : ''}`}>
              <span>{mediaMode === 'blocked' ? '🔒' : '⚠️'}</span>
              <span style={{ flex: 1 }}>{mediaWarning}</span>
              {mediaMode === 'blocked' && (
                <button className="room-retry-btn" onClick={() => { setPhase('lobby'); }}>Retry</button>
              )}
            </div>
          )}

          <div className="room-videos">
            {/* Your video */}
            <div className="video-container">
              <video
                ref={localVideoRef}
                autoPlay muted playsInline
                className="room-video-el"
                style={{ transform: 'scaleX(-1)', display: (hasLocalVideo && camOn) ? 'block' : 'none' }}
              />
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

            {/* Friend's video */}
            <div className="video-container">
              <video
                ref={remoteVideoRef}
                autoPlay playsInline
                className="room-video-el"
                style={{ display: connected ? 'block' : 'none' }}
              />
              {!connected && (
                <div className="video-placeholder">
                  <div className="video-placeholder__icon">👨‍🍳</div>
                  <div className="video-placeholder__text">{waiting ? 'Waiting for friend…' : 'Connecting…'}</div>
                </div>
              )}
              {connected && remoteCamOff && (
                <div className="video-cam-off-overlay">
                  <div className="video-placeholder__icon">🚫</div>
                  <div className="video-placeholder__text">Camera off</div>
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

          {/* Controls */}
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
              {copied ? '✓ Copied!' : '🔗 Copy Invite Link'}
            </button>
            <div className="room-link-pill" title={inviteLink}>{inviteLink}</div>
            <button className="end-btn" onClick={endCall}>✕ End Call</button>
          </div>
        </div>

        {/* ── RIGHT: Recipe ── */}
        <RecipePanel recipe={recipe} />
      </div>
    </div>
  );
}
