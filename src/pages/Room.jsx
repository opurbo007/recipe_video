import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Peer from 'peerjs';
import data from '../data/recipes.json';

/* ─── Classify getUserMedia errors ────────────────────────────────────────── */
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

/* ─── Get the best available media stream ─────────────────────────────────── */
async function getBestStream() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { stream: null, mode: 'blocked', warning: 'Camera/microphone access requires HTTPS or localhost.' };
  }

  let lastErr = null;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    return { stream, mode: 'video+audio', warning: '' };
  } catch (e) { lastErr = e; }

  const k1 = classifyError(lastErr);
  if (k1 === 'permission') return { stream: null, mode: 'blocked', warning: 'Camera & microphone blocked. Click the 🔒 icon in the address bar, allow access, then click Retry.' };
  if (k1 === 'in-use')     return { stream: null, mode: 'blocked', warning: 'Camera is used by another app (Zoom, Teams, etc.). Close it then click Retry.' };

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
  const [tab, setTab]               = useState('ingredients');
  const [checked, setChecked]       = useState({});

  if (!recipe) return (
    <aside className="room-recipe-panel room-recipe-panel--empty">
      <div className="room-recipe-panel__empty-icon">🍽️</div>
      <p>No recipe loaded.<br />Open a recipe and click<br /><strong>Make With Friend</strong>.</p>
    </aside>
  );

  const toggle   = (i) => setChecked(p => ({ ...p, [i]: !p[i] }));
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
              <li key={i} className="room-ingredient-item">
                <span className="room-ingredient-dot" />{item}
              </li>
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

/* ─── Main Room component ─────────────────────────────────────────────────── */
export default function Room() {
  const { id: roomId }    = useParams();
  const [searchParams]    = useSearchParams();
  const navigate          = useNavigate();

  // Always-present refs — never conditionally rendered
  const localVideoRef   = useRef(null);
  const remoteVideoRef  = useRef(null);
  const peerRef         = useRef(null);
  const localStreamRef  = useRef(null);
  // Store the incoming remote stream here before React re-renders the <video> element
  const remoteStreamRef = useRef(null);

  const [connected,    setConnected]    = useState(false);
  const [waiting,      setWaiting]      = useState(true);
  const [copied,       setCopied]       = useState(false);
  const [mediaMode,    setMediaMode]    = useState('');
  const [mediaWarning, setMediaWarning] = useState('');
  const [micOn,        setMicOn]        = useState(true);
  const [camOn,        setCamOn]        = useState(true);
  // Mobile browsers block autoplay with audio — track if we need user tap to unmute
  const [audioMuted,   setAudioMuted]   = useState(false);

  const recipeId   = searchParams.get('recipe');
  const recipe     = recipeId ? data.recipes.find(r => r.id === recipeId) : null;
  const inviteLink = `${window.location.origin}/room/${roomId}${recipeId ? `?recipe=${recipeId}` : ''}`;

  // PeerJS + media init
  useEffect(() => {
    let cleanupCtx = null;

    const init = async () => {
      const { stream, mode, ctx, warning } = await getBestStream();
      cleanupCtx             = ctx || null;
      localStreamRef.current = stream;

      // Wire local video directly — the <video> element is always in DOM
      if (stream && localVideoRef.current && stream.getVideoTracks().length > 0) {
        localVideoRef.current.srcObject = stream;
      }

      setMediaMode(mode);
      setMediaWarning(warning || '');

      const hostPeerId = `recipetogether-host-${roomId}`;
      const peerConfig = {
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] },
      };
      const safeStream = stream || new MediaStream();

      const onRemoteStream = (remoteStream) => {
        // Guard against PeerJS echo — reject if it matches our own local stream
        const localStream = localStreamRef.current;
        if (localStream) {
          if (remoteStream.id === localStream.id) return;
          const localTrackIds = new Set(localStream.getTracks().map(t => t.id));
          const allLocal = remoteStream.getTracks().every(t => localTrackIds.has(t.id));
          if (allLocal && remoteStream.getTracks().length > 0) return;
        }

        remoteStreamRef.current = remoteStream;
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;

          // Explicitly call play() — required on mobile (iOS Safari, Android Chrome)
          // after setting srcObject dynamically. autoPlay alone isn't enough.
          remoteVideoRef.current.play().catch(() => {
            // Autoplay with audio was blocked by the browser (mobile policy).
            // Show a "Tap to hear audio" button so the user can unblock it.
            setAudioMuted(true);
          });
        }
        setConnected(true);
        setWaiting(false);
      };

      const onCallClose = () => {
        remoteStreamRef.current = null;
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
        setConnected(false);
        setWaiting(true);
      };

      const hostPeer = new Peer(hostPeerId, peerConfig);
      peerRef.current = hostPeer;

      hostPeer.on('open', () => setWaiting(true));

      hostPeer.on('call', (call) => {
        call.answer(safeStream);
        call.on('stream', onRemoteStream);
        call.on('close',  onCallClose);
      });

      hostPeer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          // Room already has a host — join as guest
          hostPeer.destroy();
          const guestPeer = new Peer(peerConfig);
          peerRef.current = guestPeer;
          guestPeer.on('open', () => {
            const call = guestPeer.call(hostPeerId, safeStream);
            call.on('stream', onRemoteStream);
            call.on('close',  onCallClose);
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
  }, [roomId]);

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
  };

  const toggleCam = () => {
    if (!localStreamRef.current) return;
    const next = !camOn;
    localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = next; });
    setCamOn(next);
  };

  const tapToUnmute = () => {
    const vid = remoteVideoRef.current;
    if (!vid) return;
    vid.muted = false;
    vid.play().then(() => setAudioMuted(false)).catch(() => {});
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
            {/* ── LOCAL — always in DOM so ref is always valid ── */}
            <div className="video-container">
              <video
                ref={localVideoRef}
                autoPlay muted playsInline
                className="room-video-el"
                style={{ transform: 'scaleX(-1)', display: (hasLocalVideo && camOn) ? 'block' : 'none' }}
              />
              {/* Show placeholder overlay when no camera or cam is toggled off */}
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
              <span className="video-container__label">You {hasLocalVideo && camOn ? '📷' : '🎙️'}</span>
            </div>

            {/* ── REMOTE — always in DOM so ref is always valid ── */}
            <div className="video-container">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                muted={false}
                className="room-video-el"
                style={{ display: connected ? 'block' : 'none' }}
              />
              {!connected && (
                <div className="video-placeholder">
                  <div className="video-placeholder__icon">👨‍🍳</div>
                  <div className="video-placeholder__text">
                    {waiting ? 'Waiting for friend…' : 'Connecting…'}
                  </div>
                </div>
              )}
              {/* Mobile autoplay tap-to-unmute overlay */}
              {connected && audioMuted && (
                <div className="video-unmute-overlay" onClick={tapToUnmute}>
                  <div className="video-unmute-icon">🔇</div>
                  <div className="video-unmute-text">Tap to hear audio</div>
                </div>
              )}
              {connected && <span className="video-container__label">Friend 🧑‍🍳</span>}
            </div>
          </div>

          {/* Controls */}
          <div className="room-controls">
            <button className={`media-toggle-btn ${!micOn ? 'off' : ''}`} onClick={toggleMic} title={micOn ? 'Mute' : 'Unmute'}>
              {micOn ? '🎙️' : '🔇'} <span>{micOn ? 'Mute' : 'Unmute'}</span>
            </button>

            {hasLocalVideo && (
              <button className={`media-toggle-btn ${!camOn ? 'off' : ''}`} onClick={toggleCam} title={camOn ? 'Camera off' : 'Camera on'}>
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
