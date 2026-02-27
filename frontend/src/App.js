import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { QRCodeSVG } from 'qrcode.react';
import {
  BookOpen, Upload, RefreshCw, Play, Pause, SkipForward, SkipBack,
  Loader, CheckCircle, AlertCircle, Trash2, Volume2, Mic, Gauge,
  RotateCcw, RotateCw, List, Pencil, ChevronDown, ChevronUp, Info, Copy, Check,
  Moon, Search, X
} from 'lucide-react';
import './App.css';

const API = '';
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SLEEP_OPTIONS = [15, 30, 45, 60]; // minutes
const INACTIVITY_MS = 30 * 60 * 1000; // 30 minutes

// Auth helpers — store token in sessionStorage
function getAuth() {
  const token = sessionStorage.getItem('ab_token') || '';
  return { headers: { 'x-session-token': token } };
}

// Append session token to audio/image URLs (browser elements can't send headers)
function withToken(url) {
  if (!url) return url;
  const token = sessionStorage.getItem('ab_token') || '';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

// ── Lector Logo ───────────────────────────────────────────────────────────────
function LectorLogo({ size = 32 }) {
  return (
    <img src="/icon.svg" width={size} height={size} alt="Lector" style={{ display: 'block' }} />
  );
}

// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, sessionExpired }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true); setErr('');
    try {
      const { data } = await axios.post('/api/login', { username: user, password: pass });
      sessionStorage.setItem('ab_token', data.token);
      sessionStorage.setItem('ab_username', data.username || '');
      onLogin();
    } catch (e) {
      const msg = e.response?.data?.detail || e.message;
      setErr(msg);
    }
    setLoading(false);
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <LectorLogo size={48} />
        <h1>Lector</h1>
        <input className="login-input" type="text" placeholder="Username"
          value={user} onChange={e => setUser(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLogin()} />
        <input className="login-input" type="password" placeholder="Password"
          value={pass} onChange={e => setPass(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLogin()} />
        {sessionExpired && <p className="login-info">Signed out after 30 minutes of inactivity.</p>}
        {err && <p className="login-err">{err}</p>}
        <button className="btn-primary login-btn" onClick={handleLogin} disabled={loading}>
          {loading ? <Loader size={16} className="spin" /> : 'Sign In'}
        </button>
        <p className="login-disclaimer">
          For personal use only. Only convert books you own.
          Do not distribute converted audio files.
        </p>
      </div>
    </div>
  );
}

// ── Cover Art ─────────────────────────────────────────────────────────────────
function CoverArt({ book, size = 'md' }) {
  const [err, setErr] = useState(false);
  const cls = `cover cover-${size}`;

  if (book.cover_url && !err) {
    return <img className={cls} src={withToken(`${API}${book.cover_url}`)} alt={book.title} onError={() => setErr(true)} />;
  }
  const hue = [...(book.title || 'A')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const initials = (book.title || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <div className={cls} style={{ background: `linear-gradient(135deg, hsl(${hue},60%,30%), hsl(${(hue + 60) % 360},70%,20%))` }}>
      <span className="cover-initials">{initials}</span>
    </div>
  );
}

// ── About Modal ───────────────────────────────────────────────────────────────
const BTC_ADDRESS = 'bc1qkfxlhc7a5cxekkdsky2gvshhcckgz5wf8zary3';

function AboutModal({ onClose }) {
  const [info, setInfo] = useState(null);
  const [btcCopied, setBtcCopied] = useState(false);

  useEffect(() => {
    axios.get(`${API}/api/about`, getAuth())
      .then(({ data }) => setInfo(data))
      .catch(() => {});
  }, []);

  const copyBtc = () => {
    navigator.clipboard.writeText(BTC_ADDRESS).then(() => {
      setBtcCopied(true);
      setTimeout(() => setBtcCopied(false), 2000);
    });
  };

  const Row = ({ label, value }) => (
    <div className="about-row">
      <span className="about-label">{label}</span>
      <span className="about-value">{value}</span>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal about-modal" onClick={e => e.stopPropagation()}>
        <h2>About Lector</h2>
        {!info ? (
          <div className="center-col"><Loader size={32} className="spin" /></div>
        ) : (
          <>
            <section className="about-section">
              <h3 className="about-section-title">About</h3>
              <Row label="Version"     value={info.version} />
              <Row label="Python"      value={info.python} />
              <Row label="FastAPI"     value={info.fastapi} />
              <Row label="SQLite"      value={info.sqlite} />
              <Row label="Docker"      value={info.docker ? 'Yes' : 'No'} />
              <Row label="TTS Engine"  value={info.tts_engine} />
              <Row label="AI Provider" value={info.ai_provider} />
              <Row label="AppData"     value={info.appdata} />
              <Row label="Uptime"      value={info.uptime} />
            </section>
            <section className="about-section">
              <h3 className="about-section-title">More Info</h3>
              <Row label="Kokoro TTS"  value={<a href="https://github.com/hexgrad/kokoro" target="_blank" rel="noreferrer">github.com/hexgrad/kokoro</a>} />
              <Row label="Anthropic"   value={<a href="https://www.anthropic.com" target="_blank" rel="noreferrer">anthropic.com</a>} />
            </section>
            <section className="about-section">
              <h3 className="about-section-title">Donations</h3>
              <Row label="GitHub Sponsors" value={<a href="https://github.com/sponsors/LectorEpubtoAudiobook" target="_blank" rel="noreferrer">github.com/sponsors/LectorEpubtoAudiobook</a>} />
              <div className="btc-qr-wrap">
                <p className="about-label" style={{marginBottom: '.6rem'}}>Bitcoin</p>
                <QRCodeSVG
                  value={`bitcoin:${BTC_ADDRESS}`}
                  size={148}
                  bgColor="#ffffff"
                  fgColor="#0f1117"
                  level="M"
                />
                <div className="about-btc">
                  <span className="about-btc-addr" title={BTC_ADDRESS}>
                    {BTC_ADDRESS.slice(0, 14)}…{BTC_ADDRESS.slice(-8)}
                  </span>
                  <button className="btn-copy" onClick={copyBtc} title="Copy full address">
                    {btcCopied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  {btcCopied && <span className="copy-feedback">Copied!</span>}
                </div>
              </div>
            </section>
            <section className="about-section">
              <h3 className="about-section-title">Legal</h3>
              <p className="about-legal">
                This application is intended for <strong>personal use only</strong>. Only
                convert books you own. Do not reproduce, distribute, or share converted
                audio files. Converting DRM-protected content may violate applicable law
                (e.g. the DMCA in the United States). The operator of this software
                assumes no liability for misuse.
              </p>
            </section>
          </>
        )}
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>
    </div>
  );
}

// ── Upload Modal ──────────────────────────────────────────────────────────────
function UploadModal({ onClose, onComplete }) {
  const [stage, setStage] = useState('idle');
  const [bookData, setBookData] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [sampleKey, setSampleKey] = useState(0);
  const [uploadError, setUploadError] = useState(null);

  const handleFile = async (file) => {
    setUploadError(null);
    if (!file?.name.endsWith('.epub')) {
      setUploadError('Please upload an .epub file.');
      return;
    }
    setStage('uploading');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await axios.post(`${API}/api/upload`, fd, getAuth());
      setBookData(data);
      setStage('preview');
    } catch (e) {
      setUploadError('Upload failed: ' + (e.response?.data?.detail || e.message));
      setStage('idle');
    }
  };

  const handleRegen = async () => {
    setStage('uploading');
    try {
      const { data } = await axios.post(`${API}/api/regen-voice`, {
        book_id: bookData.book_id,
        exclude_voice: bookData.voice
      }, getAuth());
      setBookData(prev => ({ ...prev, ...data }));
      setSampleKey(k => k + 1);
    } catch (e) {
      setUploadError('Regen failed: ' + e.message);
    }
    setStage('preview');
  };

  const handleSubmit = async () => {
    setStage('submitting');
    await axios.post(`${API}/api/submit`, { book_id: bookData.book_id, voice: bookData.voice }, getAuth());
    onComplete();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Add New Audiobook</h2>

        {stage === 'idle' && (
          <>
            <div
              className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
              onClick={() => document.getElementById('epub-input').click()}
            >
              <Upload size={40} />
              <p>Drop your .epub file here or <span className="link">browse</span></p>
              <input id="epub-input" type="file" accept=".epub" hidden onChange={e => handleFile(e.target.files[0])} />
            </div>
            {uploadError && <p className="upload-err">{uploadError}</p>}
          </>
        )}

        {stage === 'uploading' && (
          <div className="center-col"><Loader size={40} className="spin" /><p>Analyzing book with Claude AI...</p></div>
        )}

        {stage === 'preview' && bookData && (
          <div className="preview">
            <div className="preview-header">
              <CoverArt book={{ title: bookData.title, cover_url: bookData.cover_url }} size="lg" />
              <div className="preview-meta">
                <strong className="preview-title-text">{bookData.title}</strong>
                <span className="muted">{bookData.chapter_count} chapters</span>
              </div>
            </div>
            <div className="voice-card">
              <div className="voice-header"><Mic size={16} /><span>AI-Selected Voice: <strong>{bookData.voice}</strong></span></div>
              <p className="voice-reason">{bookData.reason}</p>
              <audio key={sampleKey} controls src={withToken(`${API}${bookData.sample_url}`)} className="audio-preview" />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={handleRegen}><RefreshCw size={15} /> Try Another Voice</button>
              <button className="btn-primary" onClick={handleSubmit}><Play size={15} /> Start Converting</button>
            </div>
          </div>
        )}

        {stage === 'submitting' && (
          <div className="center-col"><Loader size={40} className="spin" /><p>Queuing conversion...</p></div>
        )}

        <button className="modal-close" onClick={onClose}>✕</button>
      </div>
    </div>
  );
}

// ── Audio Player ──────────────────────────────────────────────────────────────
function AudioPlayer({ book, onClose }) {
  const audioRef = useRef(null);
  const saveTimer = useRef(null);
  const pendingSeekRef = useRef(null);
  const sleepRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentCh, setCurrentCh] = useState(book.last_chapter || 0);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showChapters, setShowChapters] = useState(false);
  const [sleepMins, setSleepMins] = useState(null);
  const [sleepRemaining, setSleepRemaining] = useState(null);
  const chapters = book.chapters || [];

  const saveProgress = useCallback((ch, pos, completed = false) => {
    axios.post(`${API}/api/progress`, { book_id: book.id, chapter_index: ch, position_seconds: pos, completed }, getAuth());
  }, [book.id]);

  // Sleep timer countdown
  useEffect(() => {
    clearInterval(sleepRef.current);
    if (sleepMins === null) { setSleepRemaining(null); return; }
    setSleepRemaining(sleepMins * 60);
    sleepRef.current = setInterval(() => {
      setSleepRemaining(prev => {
        if (prev <= 1) {
          clearInterval(sleepRef.current);
          if (audioRef.current) audioRef.current.pause();
          setPlaying(false);
          setSleepMins(null);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(sleepRef.current);
  }, [sleepMins]);

  const cycleSleep = () => {
    if (sleepMins === null) {
      setSleepMins(SLEEP_OPTIONS[0]);
    } else {
      const next = SLEEP_OPTIONS[SLEEP_OPTIONS.indexOf(sleepMins) + 1];
      setSleepMins(next ?? null);
    }
  };

  const fmtSleep = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !chapters[currentCh]) return;
    audio.src = withToken(`${API}${chapters[currentCh].file}`);
    audio.playbackRate = speed;
    if (book.last_chapter === currentCh && book.last_position) {
      pendingSeekRef.current = book.last_position;
    }
    audio.load();
    if (playing) audio.play().catch(() => { });
  }, [currentCh]); // eslint-disable-line

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play(); setPlaying(true); }
  };

  const seekBy = (secs) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + secs));
  };

  const onTimeUpdate = () => {
    const a = audioRef.current;
    if (!a) return;
    setProgress(a.currentTime);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveProgress(currentCh, a.currentTime), 3000);
  };

  const onLoadedMetadata = (e) => {
    setDuration(e.target.duration);
    if (pendingSeekRef.current !== null) {
      e.target.currentTime = pendingSeekRef.current;
      pendingSeekRef.current = null;
    }
  };

  const onEnded = () => {
    if (currentCh < chapters.length - 1) {
      setCurrentCh(c => c + 1);
    } else {
      setPlaying(false);
      saveProgress(currentCh, audioRef.current?.duration || 0, true);
    }
  };

  const seek = e => {
    const a = audioRef.current;
    if (!a) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
  };

  const fmt = s => {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const handleClose = async () => {
    const a = audioRef.current;
    if (a) {
      const isLastChapter = currentCh >= chapters.length - 1;
      const isAtEnd = isLastChapter && duration > 0 && (duration - a.currentTime) < 5;
      try {
        await axios.post(`${API}/api/progress`,
          { book_id: book.id, chapter_index: currentCh, position_seconds: a.currentTime, completed: isAtEnd },
          getAuth()
        );
      } catch (e) { /* best effort */ }
    }
    onClose();
  };

  return (
    <div className="player-overlay" onClick={handleClose}>
      <div className="player" onClick={e => e.stopPropagation()}>
        <div className="player-header">
          <CoverArt book={book} size="player" />
          <div className="player-book-info">
            <h3>{book.title}</h3>
            <span className="muted">{book.author}</span>
          </div>
          <button className={`btn-icon ${showChapters ? 'active' : ''}`} onClick={() => setShowChapters(s => !s)} title="Chapters">
            <List size={20} />
          </button>
          <button className={`btn-icon sleep-btn ${sleepMins ? 'active' : ''}`} onClick={cycleSleep}
            title={sleepMins ? `Sleep in ${fmtSleep(sleepRemaining)}` : 'Sleep timer'}>
            <Moon size={16} />
            {sleepRemaining !== null
              ? <span className="sleep-label">{fmtSleep(sleepRemaining)}</span>
              : sleepMins
                ? <span className="sleep-label">{sleepMins}m</span>
                : null}
          </button>
          <button className="btn-icon" onClick={handleClose}>✕</button>
        </div>

        {showChapters && (
          <div className="chapter-list">
            {chapters.map((ch, i) => (
              <div key={i} className={`chapter-item ${i === currentCh ? 'active' : ''}`}
                onClick={() => { setCurrentCh(i); setPlaying(true); setShowChapters(false); }}>
                <span className="ch-num">{i + 1}</span>
                <span className="ch-title">{ch.title}</span>
                {i === currentCh && <Volume2 size={14} className="ch-playing" />}
              </div>
            ))}
          </div>
        )}

        <div className="player-controls">
          <div className="now-playing">Now: {chapters[currentCh]?.title}</div>
          <div className="progress-bar" onClick={seek}>
            <div className="progress-fill" style={{ width: `${duration ? (progress / duration) * 100 : 0}%` }} />
          </div>
          <div className="time-labels"><span>{fmt(progress)}</span><span>{fmt(duration)}</span></div>

          <div className="ctrl-row">
            <div className="speed-wrap">
              <button className="btn-speed" onClick={() => setShowSpeedMenu(s => !s)}>
                <Gauge size={15} /> {speed}x
              </button>
              {showSpeedMenu && (
                <div className="speed-menu">
                  {SPEEDS.map(s => (
                    <button key={s} className={`speed-opt ${s === speed ? 'active' : ''}`}
                      onClick={() => { setSpeed(s); setShowSpeedMenu(false); }}>
                      {s}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="ctrl-buttons">
              <button className="btn-icon" onClick={() => setCurrentCh(c => Math.max(0, c - 1))} disabled={currentCh === 0} title="Previous chapter">
                <SkipBack size={20} />
              </button>
              <button className="btn-icon" onClick={() => seekBy(-30)} title="Back 30s">
                <RotateCcw size={18} /><span className="seek-label">30</span>
              </button>
              <button className="btn-play" onClick={togglePlay}>
                {playing ? <Pause size={26} /> : <Play size={26} />}
              </button>
              <button className="btn-icon" onClick={() => seekBy(30)} title="Forward 30s">
                <RotateCw size={18} /><span className="seek-label">30</span>
              </button>
              <button className="btn-icon" onClick={() => setCurrentCh(c => Math.min(chapters.length - 1, c + 1))} disabled={currentCh >= chapters.length - 1} title="Next chapter">
                <SkipForward size={20} />
              </button>
            </div>

            <div className="volume-row">
              <Volume2 size={16} />
              <input type="range" min="0" max="1" step="0.05" value={volume}
                onChange={e => { const v = +e.target.value; setVolume(v); if (audioRef.current) audioRef.current.volume = v; }} />
            </div>
          </div>
        </div>

        <audio ref={audioRef}
          onTimeUpdate={onTimeUpdate}
          onLoadedMetadata={onLoadedMetadata}
          onEnded={onEnded} />
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDuration(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtEta(secs) {
  if (!secs || secs < 60) return `${secs}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Book Card ─────────────────────────────────────────────────────────────────
function BookCard({ book, onPlay, onDelete, onResubmit, editMode }) {
  const [summary, setSummary] = useState(book.summary || null);
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  useEffect(() => {
    if (book.status === 'ready' && !summary) {
      axios.get(`/api/book/${book.id}/summary`, getAuth())
        .then(({ data }) => setSummary(data.summary))
        .catch(() => {});
    }
  }, [book.id, book.status]); // eslint-disable-line

  const firstSentence = summary ? summary.match(/^[^.!?]+[.!?]/)?.[0]?.trim() : null;
  const restOfSummary = firstSentence && summary.length > firstSentence.length
    ? summary.slice(firstSentence.length).trim() : null;

  const statusIcon = {
    ready: <CheckCircle size={14} className="text-green" />,
    converting: <Loader size={14} className="spin text-blue" />,
    queued: <Loader size={14} className="spin text-yellow" />,
    analyzing: <Loader size={14} className="spin text-yellow" />,
    error: <AlertCircle size={14} className="text-red" />,
    preview: <Mic size={14} className="text-yellow" />,
  };

  return (
    <div className={`book-card ${book.status}`}>
      <CoverArt book={book} size="card" />
      <div className="book-info">
        <h3>{book.title}</h3>
        <p className="muted">{book.author}</p>
        <div className="status-row">
          {statusIcon[book.status]}
          <span className="status-label">{book.status}</span>
        </div>
        {(book.status === 'converting' || book.status === 'queued') && (
          <div className="conv-wrap">
            <div className="conv-labels">
              <span className="conv-pct">{book.progress_pct}%</span>
              {book.status === 'converting' && book.eta_seconds > 0
                ? <span className="conv-eta">~{fmtEta(book.eta_seconds)} remaining</span>
                : book.status === 'queued'
                  ? <span className="conv-eta">Queued...</span>
                  : null}
            </div>
            <div className="conv-progress">
              <div className="conv-fill" style={{ width: `${book.progress_pct}%` }} />
            </div>
          </div>
        )}
        {book.status === 'error' && <p className="error-msg">{book.error_msg}</p>}
        {firstSentence && (
          <div className="book-summary-inline">
            <span className="summary-text">
              {firstSentence}{!summaryExpanded && restOfSummary ? '…' : ''}
              {summaryExpanded && restOfSummary && ` ${restOfSummary}`}
            </span>
            {restOfSummary && (
              <button className="btn-expand-summary" onClick={() => setSummaryExpanded(e => !e)}
                title={summaryExpanded ? 'Show less' : 'Read more'}>
                {summaryExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="book-actions">
        {book.status === 'ready' && (
          <>
            {book.completed && <span className="badge-finished"><CheckCircle size={12} /> Finished</span>}
            <button className="btn-primary btn-sm" onClick={() => onPlay(book)}>
              <Play size={14} /> {book.completed ? 'Listen Again' : book.has_progress ? 'Continue' : 'Listen'}
            </button>
            {!book.completed && (book.time_remaining_seconds > 0 || book.total_duration_seconds > 0) && (
              <span className="duration-badge">
                {book.time_remaining_seconds > 0
                  ? `${fmtDuration(book.time_remaining_seconds)} left`
                  : fmtDuration(book.total_duration_seconds)}
              </span>
            )}
            {book.completed && book.total_duration_seconds > 0 && (
              <span className="duration-badge">{fmtDuration(book.total_duration_seconds)}</span>
            )}
          </>
        )}
        {book.status === 'preview' && (
          <button className="btn-primary btn-sm" onClick={() => onResubmit(book)}><Play size={14} /> Start Converting</button>
        )}
        {editMode && (
          <button className="btn-danger btn-sm" onClick={() => onDelete(book.id)}><Trash2 size={14} /></button>
        )}
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [library, setLibrary] = useState([]);
  const [showUpload, setShowUpload] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [activeBook, setActiveBook] = useState(null);
  const [authed, setAuthed] = useState(!!sessionStorage.getItem('ab_token'));
  const [editMode, setEditMode] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const pollRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const activeBookRef = useRef(null);
  const username = sessionStorage.getItem('ab_username') || '';

  const loadLibrary = useCallback(async () => {
    const { data } = await axios.get(`${API}/api/library`, getAuth());
    setLibrary(data);
  }, []);

  useEffect(() => {
    loadLibrary();
    pollRef.current = setInterval(() => {
      setLibrary(prev => {
        if (prev.some(b => ['converting', 'queued', 'analyzing'].includes(b.status))) loadLibrary();
        return prev;
      });
    }, 3000);
    return () => clearInterval(pollRef.current);
  }, [loadLibrary]);

  // Keep activeBookRef in sync so the inactivity timer can check it without stale closure
  useEffect(() => { activeBookRef.current = activeBook; }, [activeBook]);

  // Auto sign-out after 30 min of inactivity — paused while player is open
  useEffect(() => {
    if (!authed) return;
    const onActivity = () => { lastActivityRef.current = Date.now(); };
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }));
    const timer = setInterval(() => {
      if (!activeBookRef.current && Date.now() - lastActivityRef.current > INACTIVITY_MS) {
        clearInterval(timer);
        axios.post(`${API}/api/logout`, {}, getAuth()).catch(() => {});
        sessionStorage.removeItem('ab_token');
        sessionStorage.removeItem('ab_username');
        setSessionExpired(true);
        setAuthed(false);
        setLibrary([]);
      }
    }, 60_000);
    return () => {
      events.forEach(e => window.removeEventListener(e, onActivity));
      clearInterval(timer);
    };
  }, [authed]); // eslint-disable-line

  const handlePlay = async (book) => {
    const { data } = await axios.get(`${API}/api/book/${book.id}`, getAuth());
    setActiveBook(data);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this audiobook?')) return;
    await axios.delete(`${API}/api/book/${id}`, getAuth());
    loadLibrary();
  };

  const handleResubmit = async (book) => {
    await axios.post(`${API}/api/submit`, { book_id: book.id, voice: book.selected_voice }, getAuth());
    loadLibrary();
  };

  const handleLogout = async () => {
    await axios.post(`${API}/api/logout`, {}, getAuth()).catch(() => {});
    sessionStorage.removeItem('ab_token');
    sessionStorage.removeItem('ab_username');
    setAuthed(false);
    setLibrary([]);
  };

  if (!authed) return <LoginScreen onLogin={() => { setAuthed(true); setSessionExpired(false); loadLibrary(); }} sessionExpired={sessionExpired} />;

  const ready = library.filter(b => b.status === 'ready');
  const inProgress = library.filter(b => b.status !== 'ready');

  const q = searchQuery.trim().toLowerCase();
  const filteredReady = q
    ? ready.filter(b => b.title?.toLowerCase().includes(q) || b.author?.toLowerCase().includes(q))
    : ready;

  // Stats computed from library — no extra API call needed
  const stats = (() => {
    const total     = ready.length;
    const completed = ready.filter(b => b.completed).length;
    const started   = ready.filter(b => b.has_progress && !b.completed).length;
    let listenedSecs = 0;
    for (const b of ready) {
      if (b.completed && b.total_duration_seconds) {
        listenedSecs += b.total_duration_seconds;
      } else if (b.has_progress && b.total_duration_seconds && b.time_remaining_seconds != null) {
        listenedSecs += b.total_duration_seconds - b.time_remaining_seconds;
      }
    }
    return { total, completed, started, listenedSecs };
  })();

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="logo"><LectorLogo size={30} /><h1>Lector</h1></div>
          <div className="header-actions">
            {username && <span className="welcome-user">Welcome, {username}</span>}
            <button className="btn-primary" onClick={() => setShowUpload(true)}><Upload size={15} /> Add Book</button>
            <button className={`btn-secondary ${editMode ? 'active' : ''}`} onClick={() => setEditMode(e => !e)}>
              <Pencil size={15} /> {editMode ? 'Done' : 'Edit'}
            </button>
            <button className="btn-secondary" onClick={handleLogout}>Sign Out</button>
            <button className="btn-icon" onClick={() => setShowAbout(true)} title="About Lector"><Info size={18} /></button>
          </div>
        </div>
      </header>

      {ready.length > 0 && (
        <div className="stats-bar">
          <span>{stats.total} book{stats.total !== 1 ? 's' : ''}</span>
          {stats.started   > 0 && <span>·</span>}
          {stats.started   > 0 && <span>{stats.started} in progress</span>}
          {stats.completed > 0 && <span>·</span>}
          {stats.completed > 0 && <span>{stats.completed} finished</span>}
          {stats.listenedSecs > 60 && <span>·</span>}
          {stats.listenedSecs > 60 && <span>{fmtDuration(stats.listenedSecs)} listened</span>}
        </div>
      )}

      <main className="app-main">
        {inProgress.length > 0 && (
          <section>
            <h2 className="section-title">In Progress</h2>
            <div className="book-list">
              {inProgress.map(b => <BookCard key={b.id} book={b} onPlay={handlePlay} onDelete={handleDelete} onResubmit={handleResubmit} editMode={editMode} />)}
            </div>
          </section>
        )}
        <section>
          <div className="section-title-row">
            <h2 className="section-title">
              Library {ready.length > 0 && <span className="badge">{ready.length}</span>}
            </h2>
            {ready.length > 0 && (
              <div className="search-wrap">
                <Search size={14} className="search-icon" />
                <input
                  className="search-input"
                  placeholder="Search title or author…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button className="search-clear" onClick={() => setSearchQuery('')}><X size={13} /></button>
                )}
              </div>
            )}
          </div>
          {filteredReady.length === 0
            ? <div className="empty-state"><BookOpen size={48} /><p>{q ? 'No books match your search.' : 'No audiobooks yet. Upload an epub to get started!'}</p></div>
            : <div className="book-list">{filteredReady.map(b => <BookCard key={b.id} book={b} onPlay={handlePlay} onDelete={handleDelete} editMode={editMode} />)}</div>
          }
        </section>
      </main>

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onComplete={loadLibrary} />}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      {activeBook && <AudioPlayer book={activeBook} onClose={() => { setActiveBook(null); loadLibrary(); }} />}
    </div>
  );
}