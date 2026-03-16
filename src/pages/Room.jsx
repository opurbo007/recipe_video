import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import data from '../data/recipes.json';
import '../styles/main.css';

/* ─────────────────────────────────────────────────────────────────────────────
  SIGNALING SERVER URL
  ─────────────────────────────────────────────────────────────────────────────
  LOCAL DEV:   http://localhost:3001
  PRODUCTION:  your Render.com URL e.g. https://flavourkit-signal.onrender.com
  Change SIGNAL_URL to your deployed server URL before deploying to Vercel.
───────────────────────────────────────────────────────────────────────────── */
const SIGNAL_URL = import.meta.env.VITE_SIGNAL_URL || 'http://localhost:3001';

/* ─── ICE servers — STUN + multiple TURN for cross-network ──────────────── */
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80',   username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443',  username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:freestun.net:3479',  username: 'free', credential: 'free' },
  { urls: 'turns:freestun.net:5350', username: 'free', credential: 'free' },
];

/* ─── Attach stream + force play + explicit unmute ─────────────────────── */
function attachStream(el, stream) {
  if (!el || !stream) return;
  el.srcObject = stream;
  el.muted     = false;
  el.volume    = 1.0;
  el.play().catch(() => {
    // Browser blocked autoplay — the tap-to-unmute overlay will handle this
  });
}

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

/* ─── Request mic + camera separately (iOS one-prompt-at-a-time fix) ─────── */
async function getBestStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { stream: null, mode: 'blocked', warning: 'Camera/mic requires HTTPS.' };
  }
  let audioStream = null, videoStream = null;
  let audioWarn = '', videoWarn = '';

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (e) {
    const k = classifyError(e);
    audioWarn = k === 'permission' ? 'Mic denied — tap 🔒 → Allow Microphone.' : 'No mic detected.';
  }

  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  } catch (e) {
    const k = classifyError(e);
    videoWarn = k === 'permission' ? 'Camera denied — tap 🔒 → Allow Camera.' : 'No camera detected.';
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
        <p className="room-lobby__hint">Tap Join — your browser will ask for permission once.</p>
      </div>
    </div>
  );
}

/* ─── Debug panel ──────────────────────────────────────────────────────────── */
function DebugPanel({ logs, visible, onToggle }) {
  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999 }}>
      <button onClick={onToggle} style={{
        width: '100%', padding: '6px', background: '#1a1a1a',
        color: '#888', border: 'none', fontSize: '0.7rem', cursor: 'pointer',
        borderTop: '1px solid #333',
      }}>
        {visible ? '▼ Hide Debug' : '▲ Debug Log'}
      </button>
      {visible && (
        <div style={{
          background: '#0a0a0a', color: '#0f0', fontFamily: 'monospace',
          fontSize: '0.65rem', padding: '8px', maxHeight: '180px',
          overflowY: 'auto', borderTop: '1px solid #333',
        }}>
          {logs.map((l, i) => <div key={i}>{l}</div>)}
          {!logs.length && <div>No logs yet.</div>}
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

  const localVideoRef  = useRef(null);
  const remoteVideoRef = useRef(null);
  const socketRef      = useRef(null);
  const pcRef          = useRef(null);          // RTCPeerConnection
  const localStreamRef = useRef(null);
  const remoteIdRef    = useRef(null);          // socket ID of the other peer

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
    console.log(`[Room] ${msg}`);
    setDebugLogs(p => [`[${ts}] ${msg}`, ...p].slice(0, 80));
  }, []);

  /* ── Create RTCPeerConnection ── */
  const createPC = useCallback((localStream) => {
    if (pcRef.current) {
      pcRef.current.close();
    }

    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    pcRef.current = pc;

    // Add local tracks
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
      log(`Added local track: ${track.kind}`);
    });

    // Remote stream → attach to video
    const remoteStream = new MediaStream();
    pc.ontrack = (e) => {
      log(`ontrack: ${e.track.kind} — streams: ${e.streams.length}`);
      e.streams[0]?.getTracks().forEach(t => {
        if (!remoteStream.getTracks().find(x => x.id === t.id)) {
          remoteStream.addTrack(t);
          log(`Added remote track: ${t.kind}`);
        }
      });

      if (remoteStream.getTracks().length > 0) {
        const el = remoteVideoRef.current;
        if (el) {
          el.srcObject = remoteStream;

          /*
            AUTOPLAY TRICK:
            All browsers allow autoplay when muted=true.
            Once playback starts we immediately unmute — this is a
            programmatic unmute on a playing element which browsers allow.
            The user already gave a gesture (tapping "Join Call") so
            this is within the same gesture context session.
          */
          el.muted = true;
          el.volume = 1.0;

          el.play()
            .then(() => {
              log('Playback started (muted) — unmuting now');
              el.muted = false;
              setAudioMuted(false);
              log('Audio unmuted ✓');
            })
            .catch(err => {
              log(`play() failed even muted: ${err.name} — ${err.message}`);
              // Last resort: try completely silent then unmute on next user interaction
              setAudioMuted(true);
            });

          el.onvolumechange = () => {
            // Some browsers re-mute after a moment — catch and re-unmute
            if (el.muted && !el.paused) {
              log('Browser re-muted — forcing unmute');
              el.muted = false;
            }
          };
        }
        setConnected(true);
        setWaiting(false);
        setConnStatus('');
        log('Remote stream attached — connected!');
      }
    };

    // Queue candidates that arrive before setRemoteDescription is done
    const iceCandidateQueue = [];
    let remoteDescSet = false;

    const drainCandidateQueue = async () => {
      while (iceCandidateQueue.length) {
        const c = iceCandidateQueue.shift();
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
          log(`Queued candidate added: ${c.candidate?.substring(0, 40)}…`);
        } catch (e) { log(`Queued candidate error: ${e.message}`); }
      }
    };

    // RTCIceCandidate is NOT serializable by Socket.IO directly.
    // Must call .toJSON() — otherwise it sends {} and arrives as undefined on the other side.
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const json = e.candidate.toJSON(); // ← CRITICAL FIX
        log(`Candidate: ${json.type} / ${json.protocol}`);
        socketRef.current?.emit('ice-candidate', {
          targetId: remoteIdRef.current,
          candidate: json,
        });
      } else {
        log('ICE gathering complete');
      }
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      log(`ICE state: ${s}`);
      if (s === 'connected' || s === 'completed') {
        setIceState('');
        log('✅ ICE connected!');
      } else if (s === 'failed') {
        setIceState('failed');
        log('ICE failed — restarting');
        try { pc.restartIce(); } catch (_) {}
      } else if (s === 'disconnected') {
        setIceState('disconnected');
      } else {
        setIceState(s === 'checking' ? 'checking' : '');
      }
    };

    pc.onconnectionstatechange = () => {
      log(`Connection state: ${pc.connectionState}`);
    };

    pc.onsignalingstatechange = () => {
      log(`Signaling state: ${pc.signalingState}`);
    };

    return pc;
  }, [log]);

  /* ── Called by Lobby when user taps Join ── */
  const startCall = useCallback(({ stream, mode, warning }) => {
    localStreamRef.current = stream;
    setMediaMode(mode);
    setMediaWarning(warning || '');
    setPhase('call');
    log(`Starting call — mode: ${mode}, tracks: ${stream.getTracks().length}`);

    // Show local video
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (stream?.getVideoTracks().length > 0) {
        attachStream(localVideoRef.current, stream);
        localVideoRef.current && (localVideoRef.current.muted = true); // local is always muted
        log('Local video attached');
      }
    }));

    // Connect to signaling server
    setConnStatus('Connecting to server…');
    const socket = io(SIGNAL_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      log(`Socket connected: ${socket.id}`);
      setConnStatus('Joining room…');
      socket.emit('join-room', { roomId });
    });

    socket.on('connect_error', (err) => {
      log(`Socket connection error: ${err.message}`);
      setConnStatus(`Server error: ${err.message}. Check SIGNAL_URL.`);
    });

    socket.on('room-full', () => {
      log('Room is full');
      setConnStatus('Room is full — only 2 people per room.');
    });

    /* HOST path */
    socket.on('role', async ({ role }) => {
      log(`Role: ${role}`);
      if (role === 'host') {
        setConnStatus('Waiting for friend to join…');
        setWaiting(true);
      }
    });

    socket.on('guest-joined', async ({ guestId }) => {
      log(`Guest joined: ${guestId} — creating offer`);
      remoteIdRef.current = guestId;
      setConnStatus('Friend joined — connecting…');

      const pc = createPC(stream);

      try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);
        log('Offer created and set as local description');
        // SDP must be sent as plain JSON — RTCSessionDescription is not serializable directly
        socket.emit('offer', { targetId: guestId, offer: offer.toJSON ? offer.toJSON() : offer });
      } catch (e) {
        log(`Error creating offer: ${e.message}`);
      }
    });

    /* GUEST path */
    socket.on('offer', async ({ fromId, offer }) => {
      log(`Received offer from: ${fromId}`);
      remoteIdRef.current = fromId;
      setConnStatus('Connecting…');

      const pc = createPC(stream);

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        log('Remote description (offer) set');
        remoteDescSet = true;
        await drainCandidateQueue(); // apply any candidates that arrived early

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        log('Answer created and set');

        // SDP must also be sent as plain JSON
        socket.emit('answer', { targetId: fromId, answer: answer.toJSON ? answer.toJSON() : answer });
        log('Answer sent');
      } catch (e) {
        log(`Error handling offer: ${e.message}`);
      }
    });

    socket.on('answer', async ({ fromId, answer }) => {
      log(`Received answer from: ${fromId}`);
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        log('Remote description (answer) set ✓');
        remoteDescSet = true;
        await drainCandidateQueue(); // apply any candidates that arrived early
      } catch (e) {
        log(`Error setting answer: ${e.message}`);
      }
    });

    socket.on('ice-candidate', async ({ fromId, candidate }) => {
      if (!candidate) { log('Received null candidate (end-of-candidates)'); return; }
      log(`Received candidate from: ${fromId} — type: ${candidate.type || 'unknown'}, sdp: ${(candidate.candidate || '').substring(0, 30)}`);
      const pc = pcRef.current;
      if (!pc) return;
      if (!remoteDescSet) {
        // Remote description not set yet — queue for later
        log('Queuing candidate (remote desc not ready)');
        iceCandidateQueue.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        log(`Candidate added: ${candidate.type}`);
      } catch (e) {
        log(`Error adding candidate: ${e.message}`);
      }
    });

    socket.on('media-state', ({ micOn: m, camOn: c }) => {
      setRemoteMicOff(!m);
      setRemoteCamOff(!c);
    });

    socket.on('peer-left', () => {
      log('Peer left the room');
      setConnected(false);
      setWaiting(true);
      setConnStatus('Friend left the call.');
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      setRemoteMicOff(false);
      setRemoteCamOff(false);
      setIceState('');
    });

    socket.on('disconnect', () => {
      log('Socket disconnected');
    });
  }, [roomId, createPC, log]);

  const sendMediaState = useCallback((mic, cam) => {
    socketRef.current?.emit('media-state', {
      targetId: remoteIdRef.current,
      micOn: mic,
      camOn: cam,
    });
  }, []);

  /* Cleanup */
  useEffect(() => {
    return () => {
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      if (pcRef.current)          pcRef.current.close();
      if (socketRef.current)      socketRef.current.disconnect();
    };
  }, []);

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
  };

  const toggleCam = () => {
    if (!localStreamRef.current) return;
    const next = !camOn;
    localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = next; });
    setCamOn(next); sendMediaState(micOn, next);
  };

  const tapToUnmute = () => {
    const el = remoteVideoRef.current;
    if (!el) return;
    el.muted = false;
    el.volume = 1.0;
    el.play()
      .then(() => { setAudioMuted(false); log('Unmuted by user tap'); })
      .catch(e => log(`tapToUnmute failed: ${e.name}`));
  };

  const endCall = () => {
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    if (pcRef.current)          pcRef.current.close();
    if (socketRef.current)      socketRef.current.disconnect();
    navigate(-1);
  };

  const hasLocalVideo = mediaMode === 'video+audio' || mediaMode === 'video-only';

  if (phase === 'lobby') {
    return <Lobby recipe={recipe} roomId={roomId} onJoin={startCall} />;
  }

  const iceColors = { checking: '#f59e0b', disconnected: '#f97316', failed: '#ef4444' };

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
          {iceState && iceColors[iceState] && (
            <div style={{
              background: 'rgba(0,0,0,0.5)', border: `1px solid ${iceColors[iceState]}`,
              borderRadius: 8, padding: '8px 14px', fontSize: '0.8rem',
              color: iceColors[iceState], marginBottom: 8,
            }}>
              {iceState === 'checking'     && '🔄 Establishing connection…'}
              {iceState === 'disconnected' && '⚠️ Link unstable…'}
              {iceState === 'failed'       && '❌ Failed — tap End Call and rejoin'}
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
              {connected && audioMuted && (
                <button
                  className="video-unmute-banner"
                  onClick={tapToUnmute}
                  type="button"
                >
                  🔇 Tap anywhere to hear audio
                </button>
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
            <div className="room-link-pill" title={inviteLink}>{inviteLink}</div>
            <button className="end-btn" onClick={endCall}>✕ End</button>
          </div>
        </div>

        <RecipePanel recipe={recipe} />
      </div>

      <DebugPanel logs={debugLogs} visible={showDebug} onToggle={() => setShowDebug(v => !v)} />
    </div>
  );
}
