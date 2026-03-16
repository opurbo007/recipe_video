import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Peer from 'peerjs';
import data from '../data/recipes.json';
import '../styles/main.css';

/* ─── TURN / STUN servers ─────────────────────────────────────────────────────
   Multiple providers — if one is rate-limited or down, others kick in.
   Mobile data (4G/5G) uses Symmetric NAT — STUN alone never works.
   TURN relays ALL media through a server when direct P2P fails.
───────────────────────────────────────────────────────────────────────────── */
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  // freestun.net — primary free TURN
  { urls: 'turn:freestun.net:3479',  username: 'free', credential: 'free' },
  { urls: 'turns:freestun.net:5350', username: 'free', credential: 'free' },
  // openrelay — secondary free TURN
  { urls: 'turn:openrelay.metered.ca:80',   username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443',  username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  // relay.metered.ca — third fallback
  { urls: 'turn:relay.metered.ca:80',   username: 'e8dd65bbd622de3f9be7e49d', credential: 'uMPBQDFqxXDJuJID' },
  { urls: 'turn:relay.metered.ca:443',  username: 'e8dd65bbd622de3f9be7e49d', credential: 'uMPBQDFqxXDJuJID' },
  { urls: 'turns:relay.metered.ca:443', username: 'e8dd65bbd622de3f9be7e49d', credential: 'uMPBQDFqxXDJuJID' },
];

/* ─── Helper: attach a stream to a <video> and force play ─────────────────────
   autoPlay alone is NOT enough on mobile — we must call .play() explicitly
   after setting srcObject. Without this: black screen / no audio on iOS/Android.
───────────────────────────────────────────────────────────────────────────── */
function attachStream(videoEl, stream) {
  if (!videoEl || !stream) return;
  // Avoid redundant re-attaches which can cause flickering
  if (videoEl.srcObject === stream) return;
  videoEl.srcObject = stream;
  // play() returns a Promise — catch silently (browser will retry via autoPlay)
  videoEl.play().catch(() => {});
}

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

/* ─── Separate mic + camera requests (iOS Safari requirement) ─────────────────
   iOS only shows ONE system prompt per getUserMedia call.
   { video: true, audio: true } → only camera prompt → mic silently dropped.
   Fix: request audio first, video second, merge tracks into one stream.
───────────────────────────────────────────────────────────────────────────── */
async function getBestStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { stream: null, mode: 'blocked', warning: 'Camera/microphone requires HTTPS.' };
  }
  let audioStream = null;
  let videoStream = null;
  let audioWarning = '';
  let videoWarning = '';

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,   // ← removes echo from speakers going into mic
        noiseSuppression: true,   // ← filters background noise
        autoGainControl:  true,   // ← normalises volume levels
        sampleRate:       48000,  // ← high quality audio
      },
      video: false,
    });
  } catch (e) {
    const k = classifyError(e);
    audioWarning = k === 'permission' ? 'Microphone denied.' : k === 'in-use' ? 'Mic in use by another app.' : 'No microphone found.';
  }

  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  } catch (e) {
    const k = classifyError(e);
    videoWarning = k === 'permission' ? 'Camera denied.' : k === 'in-use' ? 'Camera in use by another app.' : 'No camera found.';
  }

  const hasAudio = !!audioStream?.getAudioTracks().length;
  const hasVideo = !!videoStream?.getVideoTracks().length;

  if (!hasAudio && !hasVideo) {
    const bothDenied = audioWarning.includes('denied') && videoWarning.includes('denied');
    return {
      stream: new MediaStream(), mode: 'no-device',
      warning: bothDenied
        ? 'Camera & mic denied. Tap 🔒 in address bar → set both to Allow → tap Retry.'
        : 'No camera or microphone detected.',
    };
  }

  const merged = new MediaStream();
  if (hasAudio) audioStream.getAudioTracks().forEach(t => merged.addTrack(t));
  if (hasVideo) videoStream.getVideoTracks().forEach(t => merged.addTrack(t));

  const mode = hasAudio && hasVideo ? 'video+audio'
             : hasAudio             ? 'audio-only'
             :                        'video-only';
  const warning = hasAudio && !hasVideo ? (videoWarning || 'No camera — audio only.')
                : !hasAudio && hasVideo ? (audioWarning || 'No mic — video only.')
                : '';

  return { stream: merged, mode, warning };
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

/* ─── Lobby screen ────────────────────────────────────────────────────────────
   getUserMedia MUST be called inside a direct user-gesture (tap/click).
   Calling it in useEffect = non-gesture = repeated prompts / silent fail on mobile.
───────────────────────────────────────────────────────────────────────────── */
function Lobby({ recipe, roomId, onJoin }) {
  const [joining,  setJoining]  = useState(false);
  const [lobbyErr, setLobbyErr] = useState('');

  const handleJoin = async () => {
    setJoining(true);
    setLobbyErr('');
    const result = await getBestStream(); // ← direct click handler = valid gesture
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
          Your browser will ask for camera &amp; mic access.
        </p>
        {lobbyErr && (
          <div className="room-lobby__error"><span>⚠️</span><span>{lobbyErr}</span></div>
        )}
        <button className="room-lobby__join-btn" onClick={handleJoin} disabled={joining}>
          {joining ? '⏳ Starting camera…' : '🎥 Join Call'}
        </button>
        <p className="room-lobby__hint">Tap Join — your browser will ask permission once.</p>
      </div>
    </div>
  );
}

/* ─── ICE state badge ─────────────────────────────────────────────────────── */
function IceBadge({ state }) {
  if (!state || state === 'connected' || state === 'completed') return null;
  const map = {
    new:          { label: 'Setting up…',       color: '#888' },
    checking:     { label: '🔄 Connecting…',    color: '#f59e0b' },
    disconnected: { label: '⚠️ Unstable link',  color: '#f97316' },
    failed:       { label: '❌ Connection failed — try End Call and rejoin', color: '#ef4444' },
    closed:       { label: 'Call ended',         color: '#888' },
  };
  const info = map[state];
  if (!info) return null;
  return (
    <div style={{
      background: 'rgba(0,0,0,0.6)', border: `1px solid ${info.color}`,
      borderRadius: 8, padding: '8px 14px', fontSize: '0.8rem',
      color: info.color, marginBottom: 8,
    }}>
      {info.label}
    </div>
  );
}

/* ─── Main Room ───────────────────────────────────────────────────────────── */
export default function Room() {
  const { id: roomId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();

  // Video elements always in DOM — never conditionally rendered
  const localVideoRef   = useRef(null);
  const remoteVideoRef  = useRef(null);
  const peerRef         = useRef(null);
  const localStreamRef  = useRef(null);
  const remoteStreamRef = useRef(null);
  const dataConnRef     = useRef(null);
  const activeCallRef   = useRef(null); // keep the MediaConnection ref

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

  const recipeId   = searchParams.get('recipe');
  const recipe     = recipeId ? data.recipes.find(r => r.id === recipeId) : null;
  const inviteLink = `${window.location.origin}/room/${roomId}${recipeId ? `?recipe=${recipeId}` : ''}`;

  /* ── DataConnection: send mic/cam state ── */
  const sendMediaState = useCallback((mic, cam) => {
    const conn = dataConnRef.current;
    if (conn?.open) conn.send({ type: 'mediaState', micOn: mic, camOn: cam });
  }, []);

  const wireDataConn = useCallback((conn) => {
    dataConnRef.current = conn;
    conn.on('data', msg => {
      if (msg?.type === 'mediaState') {
        setRemoteMicOff(!msg.micOn);
        setRemoteCamOff(!msg.camOn);
      }
    });
    conn.on('open', () => sendMediaState(micOn, camOn));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendMediaState]);

  /* ── Monitor ICE connection state ── */
  const monitorIce = useCallback((call) => {
    const pc = call?.peerConnection;
    if (!pc) return;
    let disconnectTimer = null;

    const update = () => {
      const s = pc.iceConnectionState;

      // 'disconnected' is often transient (network hiccup) — wait 4s before showing warning
      if (s === 'disconnected') {
        disconnectTimer = setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected') {
            setIceState('disconnected');
            // Attempt ICE restart — renegotiates candidates without hanging up
            try { pc.restartIce(); } catch (_) {}
          }
        }, 4000);
        return;
      }

      clearTimeout(disconnectTimer);

      // 'connected' or 'completed' = all good, clear any warning
      if (s === 'connected' || s === 'completed') {
        setIceState('');
      } else {
        setIceState(s);
      }
    };

    pc.oniceconnectionstatechange = update;
    update();
  }, []);

  /* ── Attach remote stream + force play ── */
  const onRemoteStream = useCallback((remoteStream) => {
    // Simplified echo guard — only reject if stream ID is exactly the same object
    // The old track-ID check was too aggressive and blocked real mobile streams
    const local = localStreamRef.current;
    if (local && remoteStream.id === local.id) return;

    remoteStreamRef.current = remoteStream;

    // Use the attachStream helper which calls .play() explicitly
    // This is required on mobile — autoPlay alone doesn't work for programmatic streams
    attachStream(remoteVideoRef.current, remoteStream);

    setConnected(true);
    setWaiting(false);
  }, []);

  /* ── Called by Lobby after user taps Join ── */
  const startCall = useCallback(({ stream, mode, warning }) => {
    localStreamRef.current = stream;
    setMediaMode(mode);
    setMediaWarning(warning || '');
    setPhase('call');

    // Attach local video — use requestAnimationFrame so DOM has rendered
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (stream && stream.getVideoTracks().length > 0) {
          attachStream(localVideoRef.current, stream);
        }
      });
    });

    const hostPeerId = `recipetogether-host-${roomId}`;
    const peerConfig = {
      config: {
        iceServers: ICE_SERVERS,
        iceCandidatePoolSize: 10,
        // 'all' = try direct P2P first, relay via TURN if it fails
        // Do NOT use 'relay' only — that forces TURN even when P2P works
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      },
    };
    const safeStream = stream || new MediaStream();

    const onCallClose = () => {
      remoteStreamRef.current = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      setConnected(false);
      setWaiting(true);
      setRemoteMicOff(false);
      setRemoteCamOff(false);
      setIceState('');
    };

    /* Try to become HOST */
    const hostPeer = new Peer(hostPeerId, peerConfig);
    peerRef.current = hostPeer;

    hostPeer.on('open', () => {
      setWaiting(true);
      hostPeer.on('connection', conn => wireDataConn(conn));
    });

    hostPeer.on('call', call => {
      activeCallRef.current = call;
      call.answer(safeStream);
      monitorIce(call);
      call.on('stream', onRemoteStream);
      call.on('close',  onCallClose);
    });

    hostPeer.on('error', err => {
      if (err.type === 'unavailable-id') {
        /* Become GUEST */
        hostPeer.destroy();
        const guestPeer = new Peer(peerConfig);
        peerRef.current = guestPeer;

        guestPeer.on('open', () => {
          const call = guestPeer.call(hostPeerId, safeStream);
          activeCallRef.current = call;
          monitorIce(call);
          call.on('stream', onRemoteStream);
          call.on('close',  onCallClose);

          const tryData = (n = 0) => {
            const conn = guestPeer.connect(hostPeerId, { reliable: true });
            conn.on('open', () => wireDataConn(conn));
            conn.on('error', () => { if (n < 5) setTimeout(() => tryData(n + 1), 800); });
          };
          setTimeout(() => tryData(), 500);
        });

        guestPeer.on('error', () => {});
      }
    });
  }, [roomId, wireDataConn, monitorIce, onRemoteStream]);

  /* ── Cleanup on unmount ── */
  useEffect(() => {
    return () => {
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      if (peerRef.current)        peerRef.current.destroy();
    };
  }, []);

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

  const hasLocalVideo = mediaMode === 'video+audio' || mediaMode === 'video-only';

  /* ── Lobby ── */
  if (phase === 'lobby') {
    return <Lobby recipe={recipe} roomId={roomId} onJoin={startCall} />;
  }

  /* ── Call UI ── */
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
        <div className="room-call-col">

          {/* Media permission warning */}
          {mediaWarning && (
            <div className={`room-media-warning ${mediaMode === 'blocked' ? 'room-media-warning--blocked' : ''}`}>
              <span>{mediaMode === 'blocked' ? '🔒' : '⚠️'}</span>
              <span style={{ flex: 1 }}>{mediaWarning}</span>
              {mediaMode === 'blocked' && (
                <button className="room-retry-btn" onClick={() => setPhase('lobby')}>Retry</button>
              )}
            </div>
          )}

          {/* ICE connection state badge */}
          <IceBadge state={iceState} />

          <div className="room-videos">
            {/* ── YOUR VIDEO — always in DOM, ref always valid ── */}
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

            {/* ── FRIEND'S VIDEO — always in DOM, ref always valid ── */}
            <div className="video-container">
              {/*
                video is ALWAYS rendered — just hidden via display:none.
                This keeps remoteVideoRef.current valid at all times so
                attachStream() can set srcObject the instant the stream arrives,
                without waiting for a React re-render.
              */}
              <video
                ref={remoteVideoRef}
                autoPlay playsInline
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

        <RecipePanel recipe={recipe} />
      </div>
    </div>
  );
}
