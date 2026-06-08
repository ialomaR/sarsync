import React from 'react';

const MAX_MS = 5 * 60 * 1000;

// Pick a mime type the browser actually supports. Safari uses mp4; Chrome
// and Firefox prefer webm/opus.
function pickMime() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

export function VoiceRecorder({ theme, rtl, onComplete, onCancel }) {
  const [elapsed, setElapsed] = React.useState(0);
  const recorderRef = React.useRef(null);
  const streamRef = React.useRef(null);
  const chunksRef = React.useRef([]);
  const startedAtRef = React.useRef(0);
  const [phase, setPhase] = React.useState('starting'); // 'starting' | 'recording' | 'stopping' | 'error'
  const [error, setError] = React.useState(null);

  // Latest-callback refs. The recording lifecycle effect MUST run exactly once
  // (mount → unmount); reading the callbacks through refs lets it use `[]` deps
  // so it isn't torn down every time the parent re-renders (DeptChat re-renders
  // on every incoming socket event). The old `[onComplete, onCancel]` deps made
  // each re-render stop the recorder mid-take and auto-send a partial clip.
  const onCompleteRef = React.useRef(onComplete);
  const onCancelRef = React.useRef(onCancel);
  React.useEffect(() => { onCompleteRef.current = onComplete; onCancelRef.current = onCancel; });

  // Only a deliberate Send / 5-min auto-stop should deliver the recording. A
  // stop triggered by unmount or Cancel leaves this false, so cleanup never
  // emits a voice message the user didn't choose to send.
  const deliverRef = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const mime = pickMime();
        const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        recorderRef.current = rec;
        chunksRef.current = [];
        rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          if (!deliverRef.current) return; // unmount/cancel — discard silently
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
          const durationMs = Date.now() - startedAtRef.current;
          if (chunksRef.current.length === 0) {
            onCancelRef.current?.();
          } else {
            onCompleteRef.current?.({ blob, durationMs, mimeType: rec.mimeType || 'audio/webm' });
          }
        };
        startedAtRef.current = Date.now();
        rec.start(250);
        setPhase('recording');
      } catch (err) {
        setPhase('error');
        setError(err);
      }
    })();
    return () => {
      cancelled = true;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try { recorderRef.current.stop(); } catch {}
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
    // Mount-once: callbacks are read via refs (see above), so they intentionally
    // are not dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer + auto-stop at 5min
  React.useEffect(() => {
    if (phase !== 'recording') return;
    const t = setInterval(() => {
      const ms = Date.now() - startedAtRef.current;
      setElapsed(ms);
      if (ms >= MAX_MS) {
        deliverRef.current = true; // auto-stop at the cap still sends
        try { recorderRef.current?.stop(); } catch {}
        setPhase('stopping');
      }
    }, 100);
    return () => clearInterval(t);
  }, [phase]);

  const stopAndSend = () => {
    if (phase !== 'recording') return;
    deliverRef.current = true; // the user asked to send
    setPhase('stopping');
    try { recorderRef.current?.stop(); } catch {}
  };

  const cancel = () => {
    deliverRef.current = false; // never deliver a cancelled take
    chunksRef.current = []; // discard data
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch {}
    }
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    onCancel?.();
  };

  if (phase === 'error') {
    return (
      <div style={{
        padding: '8px 12px', borderRadius: 6,
        background: '#FEE2E2', color: '#991B1B',
        fontSize: 12, display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontWeight: 600 }}>
          {rtl ? 'تعذّر الوصول إلى الميكروفون' : 'Microphone access denied'}
        </span>
        <button onClick={cancel} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#991B1B', fontSize: 12, fontFamily: 'inherit', textDecoration: 'underline',
        }}>{rtl ? 'إغلاق' : 'Close'}</button>
      </div>
    );
  }

  const totalSec = Math.floor(elapsed / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  const remainingSec = Math.max(0, Math.floor((MAX_MS - elapsed) / 1000));
  const warnLow = remainingSec <= 30;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px', borderRadius: 8,
      background: theme.bg, border: `1px solid ${theme.border}`,
    }}>
      <span style={{
        width: 10, height: 10, borderRadius: '50%',
        background: '#DC2626',
        animation: 'pulse 1s infinite',
      }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: theme.text, fontVariantNumeric: 'tabular-nums' }}>
        {mm}:{ss}
      </span>
      <span style={{ fontSize: 11, color: warnLow ? '#DC2626' : theme.muted, marginInlineStart: 4 }}>
        {warnLow
          ? (rtl ? `يتبقى ${remainingSec} ثانية` : `${remainingSec}s left`)
          : (rtl ? '/ حتى ٥ دقائق' : '/ up to 5:00')}
      </span>
      <div style={{ flex: 1 }} />
      <button onClick={cancel} style={{
        padding: '5px 12px', borderRadius: 5,
        background: 'transparent', color: theme.muted,
        border: `.5px solid ${theme.border}`, cursor: 'pointer',
        fontSize: 12, fontFamily: 'inherit',
      }}>{rtl ? 'إلغاء' : 'Cancel'}</button>
      <button onClick={stopAndSend} disabled={phase !== 'recording'} style={{
        padding: '5px 14px', borderRadius: 5,
        background: theme.accent, color: theme.accentText,
        border: 'none', cursor: 'pointer',
        fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
      }}>{rtl ? 'إرسال' : 'Send'}</button>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}

// Audio player for received voice messages.
export function VoicePlayer({ theme, rtl, src, durationMs }) {
  const ref = React.useRef(null);
  const [playing, setPlaying] = React.useState(false);
  const [pos, setPos] = React.useState(0);

  const totalSec = durationMs ? Math.round(durationMs / 1000) : 0;
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) { a.play(); setPlaying(true); }
    else { a.pause(); setPlaying(false); }
  };

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 10,
      marginTop: 4, padding: '8px 12px',
      background: theme.bg, borderRadius: 999,
      border: `.5px solid ${theme.border}`,
      maxWidth: 280,
    }}>
      <button onClick={toggle} style={{
        width: 32, height: 32, borderRadius: '50%',
        background: theme.accent, color: theme.accentText,
        border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontFamily: 'inherit', flexShrink: 0,
      }}>{playing ? '❚❚' : '▶'}</button>
      <div style={{ flex: 1, minWidth: 80 }}>
        <div style={{
          height: 3, background: theme.border, borderRadius: 2,
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0,
            background: theme.accent,
            width: durationMs ? `${(pos / (durationMs / 1000)) * 100}%` : '0%',
          }} />
        </div>
      </div>
      <span style={{ fontSize: 11, color: theme.muted, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {mm}:{ss}
      </span>
      <audio ref={ref} src={src} preload="metadata"
        onTimeUpdate={() => setPos(ref.current?.currentTime || 0)}
        onEnded={() => { setPlaying(false); setPos(0); }} />
    </div>
  );
}
