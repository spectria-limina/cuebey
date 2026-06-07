import type { RefObject } from 'react';
import type { EngStateSnapshot } from '../types.ts';

const HELP_ROWS: [string, string][] = [
  ['Space',   'Play / Pause'],
  ['Enter',   'GO (release phase hold) / Start'],
  ['R',       'Reset to beginning'],
  ['E',       'Toggle timeline editor'],
  ['L',       'Toggle lock mode'],
  ['← / →',  'Nudge clock ±0.5 s'],
  ['1 – 9',   'Set the Nth variable option on the current active card'],
];

interface HeaderProps {
  engState: EngStateSnapshot;
  videoLoaded: boolean;
  videoSynced: boolean;
  offsetText: string;
  onOffsetChange: (text: string) => void;
  clockRef: RefObject<HTMLDivElement | null>;
  onPlay: () => void;
  onGo: () => void;
  onMinus: () => void;
  onPlus: () => void;
  onReset: () => void;
  onToggleTimeline: () => void;
  hideDone: boolean;
  onToggleHideDone: () => void;
  locked: boolean;
  onToggleLock: () => void;
  showHelp: boolean;
  onToggleHelp: () => void;
}

export default function Header({
  engState, videoLoaded, videoSynced, offsetText, onOffsetChange, clockRef,
  onPlay, onGo, onMinus, onPlus, onReset, onToggleTimeline,
  hideDone, onToggleHideDone,
  locked, onToggleLock,
  showHelp, onToggleHelp,
}: HeaderProps) {
  const { started, paused, phaseHold } = engState;

  let playLabel: string, playClass: string;
  if (phaseHold) {
    playLabel = 'GO ▸'; playClass = 'play go';
  } else if (!started && !videoSynced) {
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
        <button className="nudge ghost" onClick={onMinus}>−0.5s</button>
        <button className={playClass} onClick={phaseHold ? onGo : onPlay}>{playLabel}</button>
        <button className="nudge ghost" onClick={onPlus}>+0.5s</button>
        <div className="clock" ref={clockRef}>0:00.0</div>
        <button className="ghost" onClick={onReset}>⟲ Reset</button>
      </div>

      <div className="header-controls">
        <label className="offset">
          Offset{' '}
          <input
            value={offsetText}
            onChange={e => onOffsetChange(e.target.value)}
            spellCheck={false}
          />
        </label>
        <button className="ghost" onClick={onToggleTimeline}>⤢ Timeline</button>
        <label className="toggle">
          <input type="checkbox" checked={hideDone} onChange={onToggleHideDone} />
          <span className="toggle-slider" />
          <span className="toggle-label">Hide Done</span>
        </label>
        <button
          className={'lock-btn ghost' + (locked ? ' locked' : '')}
          onClick={onToggleLock}
          title={locked ? 'Unlock editing (L)' : 'Lock editing (L)'}
        >
          {locked ? '🔒 Locked' : '🔓 Lock'}
        </button>
        <button className="ghost help-btn" onClick={onToggleHelp} title="Keyboard shortcuts">?</button>
      </div>

      {showHelp && (
        <div className="help-popup" onClick={onToggleHelp}>
          <div className="help-popup-inner" onClick={e => e.stopPropagation()}>
            <div className="help-popup-title">Keyboard Shortcuts</div>
            <table>
              <tbody>
                {HELP_ROWS.map(([key, desc]) => (
                  <tr key={key}>
                    <td><kbd>{key}</kbd></td>
                    <td>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="ghost" onClick={onToggleHelp}>Close</button>
          </div>
        </div>
      )}
    </header>
  );
}
