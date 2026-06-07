import { useRef } from 'react';

export default function Header({
  engState, videoLoaded, videoSynced, offsetText, onOffsetChange, clockRef,
  onPlay, onMinus, onPlus, onReset, onToggleTimeline, onLoadVideo,
}) {
  const fileRef = useRef(null);
  const { started, paused, phaseHold } = engState;

  let playLabel, playClass;
  if (!started && !videoSynced) {
    playLabel = '▶ Start'; playClass = 'play';
  } else if (paused) {
    playLabel = '▶ Resume'; playClass = 'play paused';
  } else {
    playLabel = '❚❚ Pause'; playClass = 'play';
  }

  return (
    <header>
      <div className="brand">
        <b>Cuebey</b>
        <span>timeline cue console</span>
      </div>
      <div className="transport">
        <button className={playClass} onClick={onPlay}>{playLabel}</button>
        <button className="nudge ghost" onClick={onMinus}>−0.5s</button>
        <button className="nudge ghost" onClick={onPlus}>+0.5s</button>
        <button className="ghost" onClick={onReset}>⟲ Reset</button>
        <button className="ghost" onClick={onToggleTimeline}>⤢ Timeline</button>
        <button className="ghost" onClick={() => fileRef.current?.click()}>
          {videoLoaded ? '⏏ Video' : '⏏ Load Video'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          hidden
          onChange={e => {
            const f = e.target.files[0];
            if (f) { onLoadVideo(f); e.target.value = ''; }
          }}
        />
      </div>
      <label className="offset">
        Offset{' '}
        <input
          value={offsetText}
          onChange={e => onOffsetChange(e.target.value)}
          spellCheck={false}
        />
      </label>
      <div className="clock" ref={clockRef}>0:00.0</div>
    </header>
  );
}
