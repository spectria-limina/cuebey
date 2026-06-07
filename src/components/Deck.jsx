import { useRef, useEffect } from 'react';
import { renderText } from '../parser.js';

export default function Deck({
  cues, vars, engState, doneDisabled,
  onDone, onSetVar, onSyncEntry, onPhaseBtn, onCardFocus,
  onHover, onUnhover, onToggleDisabled,
  registerCard, unregisterCard, locked,
}) {
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
          onHover={onHover}
          onUnhover={onUnhover}
          onToggleDisabled={onToggleDisabled}
          registerCard={registerCard}
          unregisterCard={unregisterCard}
        />
      ))}
    </section>
  );
}

function DeckCard({
  i, cue, vars, engState, doneDisabled,
  onDone, onSetVar, onSyncEntry, onPhaseBtn, onCardFocus,
  onHover, onUnhover, onToggleDisabled,
  registerCard, unregisterCard,
}) {
  const slotRef   = useRef(null);
  const cardRef   = useRef(null);
  const cdRef     = useRef(null);
  const barRef    = useRef(null);
  const barwrapRef= useRef(null);
  const stateElRef= useRef(null);
  const gbRef     = useRef(null);
  const doneBtnRef= useRef(null);

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
                    <button className="sync-btn" onClick={() => onSyncEntry(i)}>
                      ⊕ Sync
                    </button>
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
                      ▼▼
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
