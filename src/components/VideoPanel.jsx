import { useRef } from 'react';

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];

export default function VideoPanel({ videoRef, videoLoaded, synced, onSetSync, onClearSync, onRateChange }) {
  const fileRef = useRef(null);

  return (
    <div className={`video-panel${videoLoaded ? ' loaded' : ''}`}>
      {/* The <video> element always lives here so videoRef stays attached */}
      <div className="video-wrap">
        <video ref={videoRef} controls />
      </div>

      <div className="video-toolbar">
        <button className="ghost" onClick={() => fileRef.current?.click()}>
          {videoLoaded ? '⏏ Load New' : '⏏ Load Video'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          hidden
          onChange={e => {
            const f = e.target.files[0];
            if (!f) return;
            const v = videoRef.current;
            if (!v) return;
            v.src = URL.createObjectURL(f);
            v.load();
            e.target.value = '';
          }}
        />

        {videoLoaded && (
          <>
            <div className="video-sep" />
            {!synced ? (
              <button onClick={onSetSync} title="Set current video time as t=0 for the timeline">
                ⊕ Set t=0 Here
              </button>
            ) : (
              <>
                <button onClick={onSetSync} title="Re-sync: set current position as the new t=0">
                  ↺ Resync t=0
                </button>
                <button className="ghost" onClick={onClearSync}>✕ Clear Sync</button>
              </>
            )}
            <div className="video-sep" />
            <span className="video-speed-label">Speed</span>
            {SPEEDS.map(r => (
              <button
                key={r}
                className="nudge ghost video-speed-btn"
                onClick={() => onRateChange(r)}
              >
                {r}×
              </button>
            ))}
          </>
        )}
      </div>

      {synced && (
        <div className="video-sync-badge">SYNCED — GO to set phase transition points</div>
      )}
    </div>
  );
}
