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
    return { stream: null, mode: 'blocked', warning: 'Camera/microphone access requires HTTPS or localhost.' };
  }
  let lastErr = null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    return { stream, mode: 'video+audio', warning: '' };
  } catch (e) { lastErr = e; }
  const k1 = classifyError(lastErr);
  if (k1 === 'permission') return { stream: null, mode: 'blocked', warning: 'Camera & microphone blocked. Click the 🔒 icon in the address bar, allow access, then click Retry.' };
  if (k1 === 'in-use')     return { stream: null, mode: 'blocked', warning: 'Camera is used by another app (Zoom, Teams…). Close it then click Retry.' };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
    return { stream, mode: 'audio-only', warning: 'No camera detected — joining with audio only.' };
  } catch (e) { lastErr = e; }
  const k2 = classifyError(lastErr);
  if (k2 === 'permission') return { stream: null, mode: 'blocked', warning: 'Microphone blocked. Click the 🔒 icon in the address bar, allow access, then click Retry.' };
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const dest = ctx.createMediaStreamDestination();
    return { stream: dest.stream, mode: 'no-device', ctx, warning: 'No camera or microphone detected on this device.' };
  } catch (_) {}
  return { stream: null, mode: 'error', warning: 'Could not access any media device.' };
}

/* ─── Recipe side panel ───────────────────────────────────────────────────── */
function RecipePanel({ recipe }) {
  const [tab, setTab]     = useState('ingredients');
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

/* ─── Main Room ───────────────────────────────────────────────────────────── */
export default function Room() {
  const { id: roomId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();

  const localVideoRef  = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerRef        = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  // DataConnection ref — used to broadcast mic/cam state to the other peer
  const dataConnRef    = useRef(null);

  const [connected,    setConnected]    = useState(false);
  const [waiting,      setWaiting]      = useState(true);
  const [copied,       setCopied]       = useState(false);
  const [mediaMode,    setMediaMode]    = useState('');
  const [mediaWarning, setMediaWarning] = useState('');
  // Local mic/cam state
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  // Remote mic/cam state — updated via DataConnection messages
  const [remoteMicOff, setRemoteMicOff] = useState(false);
  const [remoteCamOff, setRemoteCamOff] = useState(false);

  const recipeId   = searchParams.get('recipe');
  const recipe     = recipeId ? data.recipes.find(r => r.id === recipeId) : null;
  const inviteLink = `${window.location.origin}/room/${roomId}${recipeId ? `?recipe=${recipeId}` : ''}`;

  /* Send mic/cam state over DataConnection */
  const sendMediaState = useCallback((mic, cam) => {
    const conn = dataConnRef.current;
    if (conn && conn.open) {
      conn.send({ type: 'mediaState', micOn: mic, camOn: cam });
    }
  }, []);

  /* Wire up a DataConnection (receiving messages from the other peer) */
  const wireDataConn = useCallback((conn) => {
    dataConnRef.current = conn;
    conn.on('data', (msg) => {
      if (msg?.type === 'mediaState') {
        setRemoteMicOff(!msg.micOn);
        setRemoteCamOff(!msg.camOn);
      }
    });
    conn.on('open', () => {
      // As soon as data channel opens, send our current state to the other side
      setMicOn(prev => { sendMediaState(prev, undefined); return prev; });
    });
  }, [sendMediaState]);

  /* PeerJS + media init */
  useEffect(() => {
    let cleanupCtx = null;

    const init = async () => {
      const { stream, mode, ctx, warning } = await getBestStream();
      cleanupCtx             = ctx || null;
      localStreamRef.current = stream;

      if (stream && localVideoRef.current && stream.getVideoTracks().length > 0) {
        localVideoRef.current.srcObject = stream;
      }
      setMediaMode(mode);
      setMediaWarning(warning || '');

      const hostPeerId  = `recipetogether-host-${roomId}`;
      // Data channel peer ID is separate so it doesn't clash with the media peer
      const hostDataId  = `recipetogether-data-${roomId}`;
      const peerConfig  = {
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] },
      };
      const safeStream = stream || new MediaStream();

      const onRemoteStream = (remoteStream) => {
        // Guard against PeerJS local-stream echo
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

      /* ── Try to become HOST ── */
      const hostPeer = new Peer(hostPeerId, peerConfig);
      peerRef.current = hostPeer;

      hostPeer.on('open', () => {
        setWaiting(true);
        // Host also listens for the guest's data connection
        hostPeer.on('connection', (conn) => wireDataConn(conn));
      });

      hostPeer.on('call', (call) => {
        call.answer(safeStream);
        call.on('stream', onRemoteStream);
        call.on('close',  onCallClose);
      });

      hostPeer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          /* ── Become GUEST ── */
          hostPeer.destroy();
          const guestPeer = new Peer(peerConfig);
          peerRef.current = guestPeer;

          guestPeer.on('open', () => {
            // Media call
            const call = guestPeer.call(hostPeerId, safeStream);
            call.on('stream', onRemoteStream);
            call.on('close',  onCallClose);

            // Data channel — guest initiates connection to the host's data peer ID
            // We retry until the host's data peer is ready (it registers separately)
            const tryDataConnect = (attempts = 0) => {
              const conn = guestPeer.connect(hostPeerId, { reliable: true });
              conn.on('open', () => wireDataConn(conn));
              conn.on('error', () => {
                if (attempts < 5) setTimeout(() => tryDataConnect(attempts + 1), 800);
              });
            };
            setTimeout(() => tryDataConnect(), 500);
          });

          guestPeer.on('error', () => {});
        }
      });
    };

    init();

    return () => {
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      if (peerRef.current)        peerRef.current.destroy();
      if (cleanupCtx)             cleanupCtx.close();
    };
  }, [roomId, wireDataConn]);

  /* ── Controls ── */
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
    sendMediaState(next, camOn); // ← broadcast to friend
  };

  const toggleCam = () => {
    if (!localStreamRef.current) return;
    const next = !camOn;
    localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = next; });
    setCamOn(next);
    sendMediaState(micOn, next); // ← broadcast to friend
  };

  const endCall = () => {
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    if (peerRef.current)        peerRef.current.destroy();
    navigate(-1);
  };

  const hasLocalVideo = mediaMode === 'video+audio';

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
        {/* ── LEFT: Video call ── */}
        <div className="room-call-col">
          {mediaWarning && (
            <div className={`room-media-warning ${mediaMode === 'blocked' ? 'room-media-warning--blocked' : ''}`}>
              <span>{mediaMode === 'blocked' ? '🔒' : '⚠️'}</span>
              <span style={{ flex: 1 }}>{mediaWarning}</span>
              {mediaMode === 'blocked' && (
                <button className="room-retry-btn" onClick={() => window.location.reload()}>Retry</button>
              )}
            </div>
          )}

          <div className="room-videos">
            {/* ── YOUR VIDEO ── */}
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
              {/* Your own mic/cam status icons */}
              <div className="video-status-bar">
                <span className={`vstatus-icon ${!micOn ? 'vstatus-icon--off' : ''}`}
                  title={micOn ? 'Mic on' : 'Mic muted'}>
                  {micOn ? '🎙️' : '🔇'}
                </span>
                {hasLocalVideo && (
                  <span className={`vstatus-icon ${!camOn ? 'vstatus-icon--off' : ''}`}
                    title={camOn ? 'Camera on' : 'Camera off'}>
                    {camOn ? '📷' : '🚫'}
                  </span>
                )}
              </div>
              <span className="video-container__label">You</span>
            </div>

            {/* ── FRIEND'S VIDEO ── */}
            <div className="video-container">
              <video
                ref={remoteVideoRef}
                autoPlay playsInline
                className="room-video-el"
                style={{ display: connected ? 'block' : 'none' }}
              />
              {/* Not connected yet */}
              {!connected && (
                <div className="video-placeholder">
                  <div className="video-placeholder__icon">👨‍🍳</div>
                  <div className="video-placeholder__text">
                    {waiting ? 'Waiting for friend…' : 'Connecting…'}
                  </div>
                </div>
              )}
              {/* Camera-off dark overlay */}
              {connected && remoteCamOff && (
                <div className="video-cam-off-overlay">
                  <div className="video-placeholder__icon">🚫</div>
                  <div className="video-placeholder__text">Camera off</div>
                </div>
              )}
              {/* Friend's mic/cam status icons — always visible when connected */}
              {connected && (
                <div className="video-status-bar">
                  <span className={`vstatus-icon ${remoteMicOff ? 'vstatus-icon--off' : ''}`}
                    title={remoteMicOff ? 'Friend muted' : 'Friend mic on'}>
                    {remoteMicOff ? '🔇' : '🎙️'}
                  </span>
                  <span className={`vstatus-icon ${remoteCamOff ? 'vstatus-icon--off' : ''}`}
                    title={remoteCamOff ? 'Friend camera off' : 'Friend camera on'}>
                    {remoteCamOff ? '🚫' : '📷'}
                  </span>
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

        {/* ── RIGHT: Recipe panel ── */}
        <RecipePanel recipe={recipe} />
      </div>
    </div>
  );
}
