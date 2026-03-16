import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Peer from 'peerjs';
import data from '../data/recipes.json';
import '../styles/main.css';


 const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
];;

//  Attach stream to <video> and force play() 
function attachStream(el, stream) {
  if (!el || !stream) return;
  if (el.srcObject === stream) return;
  el.srcObject = stream;
  el.play().catch(() => {});
}

//  Classify getUserMedia errors
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

// Request mic + camera separately  
async function getBestStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { stream: null, mode: 'blocked', warning: 'Camera/mic requires HTTPS.' };
  }

  let audioStream = null;
  let videoStream = null;
  let audioWarn   = '';
  let videoWarn   = '';

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
        sampleRate: 48000,
      },
      video: false,
    });
  } catch (e) {
    const k = classifyError(e);
    audioWarn = k === 'permission' ? 'Mic denied.' : k === 'in-use' ? 'Mic in use.' : 'No mic.';
  }

  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  } catch (e) {
    const k = classifyError(e);
    videoWarn = k === 'permission' ? 'Camera denied.' : k === 'in-use' ? 'Camera in use.' : 'No camera.';
  }

  const hasAudio = !!audioStream?.getAudioTracks().length;
  const hasVideo = !!videoStream?.getVideoTracks().length;

  if (!hasAudio && !hasVideo) {
    const denied = audioWarn.includes('denied') && videoWarn.includes('denied');
    return {
      stream: new MediaStream(),
      mode: 'no-device',
      warning: denied
        ? 'Camera & mic denied. Tap 🔒 in address bar → Allow both → Retry.'
        : 'No camera or mic found.',
    };
  }

  const merged = new MediaStream();
  if (hasAudio) audioStream.getAudioTracks().forEach(t => merged.addTrack(t));
  if (hasVideo) videoStream.getVideoTracks().forEach(t => merged.addTrack(t));

  const mode    = hasAudio && hasVideo ? 'video+audio' : hasAudio ? 'audio-only' : 'video-only';
  const warning = !hasAudio ? (audioWarn || 'No mic.') : !hasVideo ? (videoWarn || 'No camera.') : '';
  return { stream: merged, mode, warning };
}

//  Recipe panel
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

//  Lobby screen
function Lobby({ recipe, roomId, onJoin }) {
  const [joining,  setJoining]  = useState(false);
  const [lobbyErr, setLobbyErr] = useState('');

  const handleJoin = async () => {
    setJoining(true);
    setLobbyErr('');
    const mediaResult = await getBestStream();
    if (mediaResult.mode === 'blocked') {
      setLobbyErr(mediaResult.warning);
      setJoining(false);
      return;
    }
    onJoin(mediaResult);
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
          Works on any network — WiFi or mobile data.
        </p>
        {lobbyErr && (
          <div className="room-lobby__error"><span>⚠️</span><span>{lobbyErr}</span></div>
        )}
        <button className="room-lobby__join-btn" onClick={handleJoin} disabled={joining}>
          {joining ? '📷 Starting camera…' : '🎥 Join Call'}
        </button>
        <p className="room-lobby__hint">Your browser will ask for camera &amp; mic — tap Allow.</p>
      </div>
    </div>
  );
}

// ICE state badge
function IceBadge({ state }) {
  const map = {
    checking:     { label: '🔄 Connecting…',       color: '#f59e0b' },
    disconnected: { label: '⚠️ Link unstable…',    color: '#f97316' },
    failed:       { label: '❌ Failed — tap End Call and rejoin', color: '#ef4444' },
  };
  const info = map[state];
  if (!info) return null;
  return (
    <div style={{
      background: 'rgba(0,0,0,0.55)', border: `1px solid ${info.color}`,
      borderRadius: 8, padding: '8px 14px', fontSize: '0.8rem',
      color: info.color, marginBottom: 8,
    }}>
      {info.label}
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

  const recipeId   = searchParams.get('recipe');
  const recipe     = recipeId ? data.recipes.find(r => r.id === recipeId) : null;
  const inviteLink = `${window.location.origin}/room/${roomId}${recipeId ? `?recipe=${recipeId}` : ''}`;

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

  const monitorIce = useCallback((call) => {
    const pc = call?.peerConnection;
    if (!pc) return;
    let disconnectTimer = null;
    const update = () => {
      const s = pc.iceConnectionState;
      clearTimeout(disconnectTimer);
      if (s === 'disconnected') {
        disconnectTimer = setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected') {
            setIceState('disconnected');
            try { pc.restartIce(); } catch (_) {}
          }
        }, 4000);
        return;
      }
      setIceState(s === 'connected' || s === 'completed' ? '' : s);
    };
    pc.oniceconnectionstatechange = update;
    update();
  }, []);

  const onRemoteStream = useCallback((remoteStream) => {
    const local = localStreamRef.current;
    if (local && remoteStream.id === local.id) return;
    remoteStreamRef.current = remoteStream;
    attachStream(remoteVideoRef.current, remoteStream);
    setConnected(true);
    setWaiting(false);
    setConnStatus('');
  }, []);

//  Called by Lobby after user taps Join 
  const startCall = useCallback(({ stream, mode, warning }) => {
    localStreamRef.current = stream;
    setMediaMode(mode);
    setMediaWarning(warning || '');
    setPhase('call');

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (stream?.getVideoTracks().length > 0) attachStream(localVideoRef.current, stream);
      });
    });

    const hostPeerId = `me&u-host-${roomId}`;


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

    const onCallClose = () => {
      remoteStreamRef.current = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      setConnected(false);
      setWaiting(true);
      setRemoteMicOff(false);
      setRemoteCamOff(false);
      setIceState('');
      setConnStatus('');
    };

    setConnStatus('Connecting to server…');

    /* Try to become HOST */
    const hostPeer = new Peer(hostPeerId, peerConfig);
    peerRef.current = hostPeer;

    hostPeer.on('open', () => {
      setWaiting(true);
      setConnStatus('Waiting for friend…');
      hostPeer.on('connection', conn => wireDataConn(conn));
    });

    hostPeer.on('call', call => {
      activeCallRef.current = call;
      setConnStatus('Friend joining — establishing relay…');
      call.answer(safeStream);
      monitorIce(call);
      call.on('stream', onRemoteStream);
      call.on('close',  onCallClose);
    });

    hostPeer.on('error', err => {
      if (err.type === 'unavailable-id') {
        /* Become GUEST */
        setConnStatus('Joining room…');
        hostPeer.destroy();
        const guestPeer = new Peer(peerConfig);
        peerRef.current = guestPeer;

        guestPeer.on('open', () => {
          setConnStatus('Calling host — establishing relay…');
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

        guestPeer.on('error', e => {
          setConnStatus(`Error: ${e.type} — tap End Call and try again.`);
        });
      } else {
        setConnStatus(`Error: ${err.type} — tap End Call and try again.`);
      }
    });
  }, [roomId, wireDataConn, monitorIce, onRemoteStream]);

  useEffect(() => {
    return () => {
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      if (peerRef.current)        peerRef.current.destroy();
    };
  }, []);

  const copyInviteLink = async () => {
    try { await navigator.clipboard.writeText(inviteLink); }
    catch {
      const el = document.createElement('textarea');
      el.value = inviteLink; document.body.appendChild(el);
      el.select(); document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const toggleMic = () => {
    if (!localStreamRef.current) return;
    const next = !micOn;
    localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = next; });
    setMicOn(next); sendMediaState(next, camOn);
  };

  const toggleCam = () => {
    if (!localStreamRef.current) return;
    const next = !camOn;
    localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = next; });
    setCamOn(next); sendMediaState(micOn, next);
  };

  const endCall = () => {
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    if (peerRef.current)        peerRef.current.destroy();
    navigate(-1);
  };

  const hasLocalVideo = mediaMode === 'video+audio' || mediaMode === 'video-only';

  if (phase === 'lobby') {
    return <Lobby recipe={recipe} roomId={roomId} onJoin={startCall} />;
  }

  return (
    <div className="room-page">
      <nav className="room-nav">
        <div className="room-nav__logo">Flavour<span>Kit</span> · Live</div>
        <div className="room-nav__center">
          <div className={`status-dot ${waiting ? 'waiting' : ''}`} />
          <span className="status-text">
            {connected ? '🎉 Connected — cook away!'
              : connStatus || (waiting ? 'Waiting for friend…' : 'Connecting…')}
          </span>
        </div>
        <div className="room-nav__id">Room: {roomId}</div>
      </nav>

      <div className="room-layout">
        <div className="room-call-col">
          {mediaWarning && (
            <div className={`room-media-warning ${mediaMode === 'blocked' ? 'room-media-warning--blocked' : ''}`}>
              <span>⚠️</span>
              <span style={{ flex: 1 }}>{mediaWarning}</span>
              {mediaMode === 'blocked' && (
                <button className="room-retry-btn" onClick={() => setPhase('lobby')}>Retry</button>
              )}
            </div>
          )}
          <IceBadge state={iceState} />

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
