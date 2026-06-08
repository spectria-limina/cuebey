import { useRef, useEffect } from 'react';
import { renderText } from '../parser.ts';
import { fmtHMS } from '../format.ts';
import type { Cue, VarsRecord, EngStateSnapshot, CardDomRefs, CueChanges } from '../types.ts';

interface DeckProps {
  cues: Cue[];
  vars: VarsRecord;
  engState: EngStateSnapshot;
  doneDisabled: boolean;
  onDone: (i: number) => void;
  onSetVar: (name: string, val: string) => void;
  onSyncEntry: (i: number) => void;
  onPhaseBtn: () => void;
  onCardFocus: (i: number) => void;
  onDoubleClick: (i: number) => void;
  onHover: (i: number) => void;
  onUnhover: (i: number) => void;
  onToggleDisabled: (i: number) => void;
  registerCard: (i: number, refs: CardDomRefs) => void;
  unregisterCard: (i: number) => void;
  locked: boolean;
  onEditCue: (i: number, changes: CueChanges) => void;
  getCurrentTime: () => number;
  offsetSec: number;
}

export default function Deck({
  cues, vars, engState, doneDisabled,
  onDone, onSetVar, onSyncEntry, onPhaseBtn, onCardFocus, onDoubleClick,
  onHover, onUnhover, onToggleDisabled,
  registerCard, unregisterCard, locked,
  onEditCue, getCurrentTime, offsetSec,
}: DeckProps) {
  return (
    <section className="deck" id="deck">
      {cues.map((cue, i) => (
        <DeckCard
          key={i}
          i={i}
          cue={cue}
          vars={vars}
          engState={engState}
          doneDisabled={doneDisabled}
          onDone={onDone}
          onSetVar={onSetVar}
          onSyncEntry={onSyncEntry}
          onPhaseBtn={onPhaseBtn}
          onCardFocus={onCardFocus}
          onDoubleClick={onDoubleClick}
          onHover={onHover}
          onUnhover={onUnhover}
          onToggleDisabled={onToggleDisabled}
          registerCard={registerCard}
          unregisterCard={unregisterCard}
          locked={locked}
          onEditCue={onEditCue}
          getCurrentTime={getCurrentTime}
          offsetSec={offsetSec}
        />
      ))}
    </section>
  );
}

interface DeckCardProps {
  i: number;
  cue: Cue;
  vars: VarsRecord;
  engState: EngStateSnapshot;
  doneDisabled: boolean;
  onDone: (i: number) => void;
  onSetVar: (name: string, val: string) => void;
  onSyncEntry: (i: number) => void;
  onPhaseBtn: () => void;
  onCardFocus: (i: number) => void;
  onDoubleClick: (i: number) => void;
  onHover: (i: number) => void;
  onUnhover: (i: number) => void;
  onToggleDisabled: (i: number) => void;
  registerCard: (i: number, refs: CardDomRefs) => void;
  unregisterCard: (i: number) => void;
  locked: boolean;
  onEditCue: (i: number, changes: CueChanges) => void;
  getCurrentTime: () => number;
  offsetSec: number;
}

function DeckCard({
  i, cue, vars, engState, doneDisabled,
  onDone, onSetVar, onSyncEntry, onPhaseBtn, onCardFocus, onDoubleClick,
  onHover, onUnhover, onToggleDisabled,
  registerCard, unregisterCard, locked,
  onEditCue, getCurrentTime, offsetSec,
}: DeckCardProps) {
  const slotRef    = useRef<HTMLDivElement>(null);
  const cardRef    = useRef<HTMLDivElement>(null);
  const cdRef      = useRef<HTMLDivElement>(null);
  const barRef     = useRef<HTMLDivElement>(null);
  const barwrapRef = useRef<HTMLDivElement>(null);
  const stateElRef = useRef<HTMLDivElement>(null);
  const gbRef      = useRef<HTMLButtonElement>(null);
  const doneBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    registerCard(i, {
      slot:    slotRef.current,
      card:    cardRef.current,
      cd:      cdRef.current,
      bar:     barRef.current,
      barwrap: barwrapRef.current,
      stateEl: stateElRef.current,
      gbEl:    gbRef.current,
      doneBtn: doneBtnRef.current,
    });
    return () => unregisterCard(i);
  }, [i, registerCard, unregisterCard]);

  const isNote  = cue.type === 'note';
  const isPhase = cue.type === 'phase';
  const isEvent = cue.type === 'event';
  const isCast  = cue.type === 'cast';

  const typeClass = isNote ? ' note' : isPhase ? ' phase' : isEvent ? ' event' : isCast ? ' cast' : '';

  return (
    <div className="slot" ref={slotRef}>
      <div className="cardwrap">
        <div
          className={'card' + typeClass + ' is-gray'}
          ref={cardRef}
          style={{ zIndex: 9999 - i }}
          onClick={() => onCardFocus(i)}
          onDoubleClick={() => onDoubleClick?.(i)}
          onMouseEnter={() => onHover?.(i)}
          onMouseLeave={() => onUnhover?.(i)}
        >
          <div className="card-state" ref={stateElRef} />
          <div className="card-body">
            <div className="cd" ref={cdRef} />
            <div
              className="card-text"
              dangerouslySetInnerHTML={{ __html: renderText(cue.text, vars) }}
            />
            <div className="card-btns" onClick={e => e.stopPropagation()}>
              {isPhase ? (
                <button className="go-btn" ref={gbRef} onClick={onPhaseBtn}>
                  {engState.started ? 'GO ▸' : '▶ Start'}
                </button>
              ) : (
                <>
                  {cue.sets.map(s => (
                    <div key={s.name} className="vgroup">
                      <span className="vglabel">{s.displayLabel || s.name}</span>
                      {s.options.map((opt, ki) => (
                        <button
                          key={opt}
                          className={vars[s.name]?.value === opt ? 'on' : ''}
                          onClick={() => onSetVar(s.name, opt)}
                        >
                          {s.labels?.[ki] ?? opt}
                        </button>
                      ))}
                    </div>
                  ))}
                  {(isEvent || isCast) && (
                    <button className="sync-btn" onClick={() => onSyncEntry(i)}>⏱ Sync</button>
                  )}
                  {!locked && (
                    <div className="settime-btns">
                      <button className="settime-btn settime-now" title="Set cue time to now" onClick={() => {
                        const t = getCurrentTime();
                        onEditCue(i, { rawTime: fmtHMS(Math.max(0, t + offsetSec)) });
                      }}>↓ Now</button>
                      <button className="settime-btn settime-ready" title="Set ready window to start now" onClick={() => {
                        const t = getCurrentTime();
                        onEditCue(i, { warn: Math.max(0, cue.effTime - t) });
                      }}>↓ Ready</button>
                      <button className="settime-btn settime-standby" title="Set standby to start now" onClick={() => {
                        const t = getCurrentTime();
                        onEditCue(i, { standby: Math.max(0, cue.effTime - t) });
                      }}>↓ Standby</button>
                      <button className="settime-btn settime-remain" title="Set remain to elapsed since cue" onClick={() => {
                        const t = getCurrentTime();
                        onEditCue(i, { remain: Math.max(0, t - cue.effTime) });
                      }}>↓ Remain</button>
                    </div>
                  )}
                  {cue.disabled ? (
                    <button
                      className="restore-btn"
                      onClick={() => onToggleDisabled?.(i)}
                    >
                      ↺ Enable
                    </button>
                  ) : (
                    <button
                      ref={doneBtnRef}
                      className="skip-btn"
                      onClick={() => onDone(i)}
                      disabled={doneDisabled}
                    >
                      ⇓
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          <button
            className="card-pencil"
            title="Edit in timeline"
            onClick={e => { e.stopPropagation(); onCardFocus(i); }}
          >
            ✎
          </button>
          <div className="barwrap hide" ref={barwrapRef}>
            <div className="bar" ref={barRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
