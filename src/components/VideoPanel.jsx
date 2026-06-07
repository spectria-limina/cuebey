import { useRef } from 'react';

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];
const FPS_OPTIONS = [24, 25, 29.97, 30, 60];

export default function VideoPanel({
  videoRef, videoLoaded, synced,
  onSetSync, onClearSync, onUnload,
  onLoadFile, onRateChange,
  fps, onFpsChange, onFrameStep,
}) {
  const fileRef = useRef(null);

  return (
    <div className={`video-panel${videoLoaded ? ' loaded' : ''}`}>
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
            if (f) { onLoadFile?.(f); e.target.value = ''; }
          }}
        />

        {videoLoaded && (
          <>
            <button className="ghost" onClick={onUnload} title="Remove the loaded video">
              ✕ Unload
            </button>
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
            <div className="video-sep" />
            <span className="video-speed-label">Frame</span>
            <button className="nudge ghost video-speed-btn" onClick={() => onFrameStep(-1)}>−1f</button>
            <button className="nudge ghost video-speed-btn" onClick={() => onFrameStep(1)}>+1f</button>
            <select
              className="fps-select"
              value={fps}
              onChange={e => onFpsChange(Number(e.target.value))}
              title="Frame rate for ±1f buttons"
            >
              {FPS_OPTIONS.map(f => (
                <option key={f} value={f}>{f} fps</option>
              ))}
            </select>
          </>
        )}
      </div>

      {synced && (
        <div className="video-sync-badge">SYNCED — GO to set phase transition points</div>
      )}
    </div>
  );
}
