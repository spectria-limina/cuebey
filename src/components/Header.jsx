export default function Header({
  engState, offsetText, onOffsetChange, clockRef,
  onPlay, onMinus, onPlus, onReset, onToggleTimeline,
}) {
  const { started, paused } = engState;
  const playLabel = !started ? '▶ Start' : paused ? '▶ Resume' : '❚❚ Pause';
  const playClass = 'play' + (!started || !paused ? '' : ' paused');

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
