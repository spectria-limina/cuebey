import { useRef } from 'react';
import type { RefObject } from 'react';
import { parseTime } from '../format.ts';
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

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2];

interface HeaderProps {
  engState: EngStateSnapshot;
  videoLoaded: boolean;
  videoSynced: boolean;
  offsetText: string;
  onOffsetChange: (text: string) => void;
  clockRef: RefObject<HTMLInputElement | null>;
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
  onLoadVideo: (file: File) => void;
  onUnloadVideo: () => void;
  onSpeedChange: (rate: number) => void;
  onClockSeek: (t: number) => void;
  onClockBlur: () => void;
}

export default function Header({
  engState, videoLoaded, videoSynced, offsetText, onOffsetChange, clockRef,
  onPlay, onGo, onMinus, onPlus, onReset, onToggleTimeline,
  hideDone, onToggleHideDone,
  locked, onToggleLock,
  showHelp, onToggleHelp,
  onLoadVideo, onUnloadVideo, onSpeedChange, onClockSeek, onClockBlur,
}: HeaderProps) {
  const { started, paused, phaseHold } = engState;
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function handleClockKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const t = parseTime(e.currentTarget.value);
      if (t !== null) onClockSeek(t);
      else e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.currentTarget.blur();
    }
  }

  function handleClockBlur() {
    onClockBlur();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onLoadVideo(file);
    // Reset so the same file can be re-loaded
    e.target.value = '';
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
        <input
          className="clock-input"
          ref={clockRef}
          defaultValue="0:00.0"
          onKeyDown={handleClockKeyDown}
          onBlur={handleClockBlur}
          spellCheck={false}
          autoComplete="off"
        />
        <button className="ghost" onClick={onReset}>⟲ Reset</button>

        <span className="transport-sep" />

        <label className="offset">
          Offset{' '}
          <input
            value={offsetText}
            onChange={e => onOffsetChange(e.target.value)}
            spellCheck={false}
          />
        </label>

        <span className="transport-sep" />

        <select
          className="speed-select"
          defaultValue={1}
          onChange={e => onSpeedChange(Number(e.target.value))}
          disabled={!videoLoaded}
          title="Playback speed"
        >
          {SPEED_OPTIONS.map(s => (
            <option key={s} value={s}>{s}×</option>
          ))}
        </select>

        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        {videoLoaded ? (
          <button className="ghost" onClick={onUnloadVideo}>⏏ Unload Video</button>
        ) : (
          <button className="ghost" onClick={() => fileInputRef.current?.click()}>▶ Load Video</button>
        )}
      </div>

      <div className="header-controls">
        <button className="ghost" onClick={onToggleTimeline}>⤢ Timeline</button>
        <label className="toggle">
          <input type="checkbox" checked={hideDone} onChange={onToggleHideDone} />
          <span className="toggle-slider" />
          <span className="toggle-label">Hide Done</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={locked} onChange={onToggleLock} />
          <span className="toggle-slider" />
          <span className="toggle-label">Lock</span>
        </label>
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
