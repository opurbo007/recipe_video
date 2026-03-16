import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Peer from 'peerjs';
import data from '../data/recipes.json';
import '../styles/main.css';

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
async function getBestStream() {
  if (!navigator.mediaDevices?.getUserMedia)
    return { stream: null, mode: 'blocked', warning: 'Camera/mic requires HTTPS.' };

  let audioStream = null, videoStream = null;
  let audioWarn = '', videoWarn = '';

  try { audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
  catch(e) { audioWarn = 'Mic denied or unavailable'; }

  try { videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true }); }
  catch(e) { videoWarn = 'Camera denied or unavailable'; }

  const merged = new MediaStream();
  if (audioStream) audioStream.getAudioTracks().forEach(t => merged.addTrack(t));
  if (videoStream) videoStream.getVideoTracks().forEach(t => merged.addTrack(t));

  const mode = audioStream && videoStream ? 'video+audio' : audioStream ? 'audio-only' : 'video-only';
  const warning = !audioStream ? audioWarn : !videoStream ? videoWarn : '';

  return { stream: merged, mode, warning };
}

function attachStream(el, stream) {
  if (!el || !stream) return;
  el.srcObject = stream;
  el.muted = false;
  el.volume = 1.0;
  el.play().catch(() => {});
}

/* ─── Lobby ────────────────────────────────────────────────────────────────── */
function Lobby({ recipe, roomId, onJoin }) {
  const [joining, setJoining] = useState(false);
  const [lobbyErr, setLobbyErr] = useState('');

  const handleJoin = async () => {
    setJoining(true);
    setLobbyErr('');
    try {
      await onJoin();
    } catch(e) {
      setLobbyErr(e.message || 'Failed to start call');
    } finally {
      setJoining(false);
    }
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
        {lobbyErr && <div className="room-lobby__error"><span>⚠️</span> {lobbyErr}</div>}
        <button className="room-lobby__join-btn" onClick={handleJoin} disabled={joining}>
          {joining ? '📷 Starting camera…' : '🎥 Join Call'}
        </button>
        <p className="room-lobby__hint">Tap Join — your browser will ask for permission once.</p>
      </div>
    </div>
  );
}

/* ─── Recipe Panel ────────────────────────────────────────────────────────── */
function RecipePanel({ recipe }) {
  const [tab, setTab] = useState('ingredients');
  const [checked, setChecked] = useState({});

  if (!recipe) return (
    <aside className="room-recipe-panel room-recipe-panel--empty">
      <div className="room-recipe-panel__empty-icon">🍽️</div>
      <p>No recipe loaded.<br />Open a recipe and click<br /><strong>Make With Friend</strong>.</p>
    </aside>
  );

  const toggle = i => setChecked(p => ({ ...p, [i]: !p[i] }));
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
          Steps <span className={`room-tab__count ${doneCount > 0 ? 'room-tab__count--done' : ''}`}>
            {doneCount > 0 ? `${doneCount}/${recipe.instructions.length}` : recipe.instructions.length}
          </span>
        </button>
      </div>
      <div className="room-recipe-panel__content">
        {tab === 'ingredients' && (
          <ul className="room-ingredients">
            {recipe.ingredients.map((item, i) => <li key={i} className="room-ingredient-item">{item}</li>)}
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

/* ─── Main Room ───────────────────────────────────────────────────────────── */
export default function Room() {
  const { id: roomId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const recipeId = searchParams.get('recipe');
  const recipe = recipeId ? data.recipes.find(r => r.id === recipeId) : null;
  const inviteLink = `${window.location.origin}/room/${roomId}${recipeId ? `?recipe=${recipeId}` : ''}`;

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerRef = useRef(null);
  const callRef = useRef(null);
  const localStreamRef = useRef(null);

  const [phase, setPhase] = useState('lobby');
  const [connected, setConnected] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [copied, setCopied] = useState(false);
  const [mediaMode, setMediaMode] = useState('');
  const [mediaWarning, setMediaWarning] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [audioMuted, setAudioMuted] = useState(true);

  /* ─── Logging ──────────────────────────────────────────────────────────── */
  const log = useCallback((msg) => console.log(`[Room] ${msg}`), []);

  /* ─── Start Call ───────────────────────────────────────────────────────── */
  const startCall = useCallback(async () => {
    const { stream, mode, warning } = await getBestStream();
    localStreamRef.current = stream;
    setMediaMode(mode);
    setMediaWarning(warning || '');
    setPhase('call');

    if (stream.getVideoTracks().length > 0)
      attachStream(localVideoRef.current, stream);

    const peer = new Peer(roomId, { debug: 2 });
    peerRef.current = peer;

    peer.on('open', id => log(`PeerJS ready: ${id}`));

    peer.on('call', call => {
      log('Incoming call received');
      call.answer(stream);
      call.on('stream', remoteStream => {
        attachStream(remoteVideoRef.current, remoteStream);
        setConnected(true);
        setWaiting(false);
        log('Remote stream attached');
      });
      callRef.current = call;
    });

    // Auto-call other peer after small delay
    setTimeout(() => {
      if (peer.id !== roomId) {
        const call = peer.call(roomId, stream);
        call.on('stream', remoteStream => {
          attachStream(remoteVideoRef.current, remoteStream);
          setConnected(true);
          setWaiting(false);
        });
        callRef.current = call;
      }
    }, 500);
  }, [roomId, log]);

  const toggleMic = () => {
    if (!localStreamRef.current) return;
    const next = !micOn;
    localStreamRef.current.getAudioTracks().forEach(t => t.enabled = next);
    setMicOn(next);
  };

  const toggleCam = () => {
    if (!localStreamRef.current) return;
    const next = !camOn;
    localStreamRef.current.getVideoTracks().forEach(t => t.enabled = next);
    setCamOn(next);
  };

  const tapToUnmute = () => {
    const el = remoteVideoRef.current;
    if (!el) return;
    el.muted = false;
    el.volume = 1.0;
    el.play().then(() => setAudioMuted(false)).catch(() => {});
  };

  const copyInviteLink = async () => {
    try { await navigator.clipboard.writeText(inviteLink); } catch {
      const el = document.createElement('textarea'); el.value = inviteLink;
      document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el);
    }
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  const endCall = () => {
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    if (callRef.current) callRef.current.close();
    if (peerRef.current) peerRef.current.destroy();
    navigate(-1);
  };

  useEffect(() => () => endCall(), []);

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
          <span className="status-text">{connected ? '🎉 Connected!' : waiting ? 'Waiting for friend…' : 'Connecting…'}</span>
        </div>
        <div className="room-nav__id">{roomId}</div>
      </nav>

      <div className="room-layout">
        <div className="room-call-col">
          {mediaWarning && (
            <div className="room-media-warning">
              <span>⚠️</span> {mediaWarning}
              <button className="room-retry-btn" onClick={() => setPhase('lobby')}>Retry</button>
            </div>
          )}

          <div className="room-videos">
            {/* YOUR VIDEO */}
            <div className="video-container">
              <video ref={localVideoRef} autoPlay muted playsInline className="room-video-el"
                style={{ transform: 'scaleX(-1)', display: (hasLocalVideo && camOn) ? 'block' : 'none' }} />
              {(!hasLocalVideo || !camOn) && <div className="video-placeholder">{!hasLocalVideo ? '📵' : '🚫'}</div>}
              <span className="video-container__label">You</span>
            </div>

            {/* FRIEND'S VIDEO */}
            <div className="video-container">
              <video ref={remoteVideoRef} autoPlay playsInline className="room-video-el"
                style={{ display: connected ? 'block' : 'none' }} />
              {!connected && <div className="video-placeholder">👨‍🍳 Waiting for friend…</div>}
              {connected && audioMuted &&
                <button className="video-unmute-banner" onClick={tapToUnmute}>🔇 Tap to unmute</button>}
              <span className="video-container__label">Friend 🧑‍🍳</span>
            </div>
          </div>

          <div className="room-controls">
            <button onClick={toggleMic}>{micOn ? '🎙️ Mute' : '🔇 Unmute'}</button>
            {hasLocalVideo && <button onClick={toggleCam}>{camOn ? '📷 Cam off' : '🚫 Cam on'}</button>}
            <button onClick={copyInviteLink}>{copied ? '✓ Copied!' : '🔗 Copy Link'}</button>
            <button onClick={endCall}>✕ End</button>
          </div>
        </div>

        <RecipePanel recipe={recipe} />
      </div>
    </div>
  );
}