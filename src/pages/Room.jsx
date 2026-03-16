import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Peer from 'peerjs';
import data from '../data/recipes.json';
import '../styles/main.css';


async function getBestStream() {
  if (!navigator.mediaDevices?.getUserMedia) return { stream: null, mode: 'blocked', warning: 'Camera/mic requires HTTPS.' };
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
  const [debugLogs, setDebugLogs] = useState([]);

  const log = useCallback((msg) => {
    const ts = new Date().toLocaleTimeString();
    console.log(`[Room] ${msg}`);
    setDebugLogs(p => [`[${ts}] ${msg}`, ...p].slice(0, 80));
  }, []);

  const startCall = useCallback(async () => {
    const { stream, mode, warning } = await getBestStream();
    localStreamRef.current = stream;
    setMediaMode(mode);
    setMediaWarning(warning || '');
    setPhase('call');
    if (stream.getVideoTracks().length > 0) attachStream(localVideoRef.current, stream);

    const peer = new Peer(roomId, { debug: 2 }); // roomId as host peer
    peerRef.current = peer;

    peer.on('open', () => log(`PeerJS ready: ${peer.id}`));

    peer.on('call', (call) => {
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

    // Auto-call host if not self
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

 if (phase === 'lobby') { return <Lobby recipe={recipe} roomId={roomId} onJoin={startCall} />; } const iceColors = { checking: '#f59e0b', disconnected: '#f97316', failed: '#ef4444' };

  return (
    <div className="room-page">
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

      
    </div>
  );
}
