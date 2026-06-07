import { useRef, useEffect } from 'react';
import { renderText } from '../parser.js';

export default function Deck({ cues, vars, engState, doneDisabled, onDone, onSetVar, onPhaseBtn, registerCard, unregisterCard }) {
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
          onPhaseBtn={onPhaseBtn}
          registerCard={registerCard}
          unregisterCard={unregisterCard}
        />
      ))}
    </section>
  );
}

function DeckCard({ i, cue, vars, engState, doneDisabled, onDone, onSetVar, onPhaseBtn, registerCard, unregisterCard }) {
  const slotRef = useRef(null);
  const cardRef = useRef(null);
  const cdRef = useRef(null);
  const barRef = useRef(null);
  const barwrapRef = useRef(null);
  const stateElRef = useRef(null);
  const gbRef = useRef(null);

  useEffect(() => {
    registerCard(i, {
      slot: slotRef.current,
      card: cardRef.current,
      cd: cdRef.current,
      bar: barRef.current,
      barwrap: barwrapRef.current,
      stateEl: stateElRef.current,
      gbEl: gbRef.current,
    });
    return () => unregisterCard(i);
  }, [i, registerCard, unregisterCard]);

  const isNote = cue.type === 'note';
  const isPhase = cue.type === 'phase';

  return (
    <div className="slot" ref={slotRef}>
      <div className="cardwrap">
        <div
          className={'card' + (isNote ? ' note' : '') + (isPhase ? ' phase' : '') + ' is-gray'}
          ref={cardRef}
          style={{ zIndex: 9999 - i }}
        >
          <div className="card-timer">
            <div className="cd" ref={cdRef} />
            <div className="barwrap hide" ref={barwrapRef}>
              <div className="bar" ref={barRef} />
            </div>
          </div>

          <div className="card-main">
            <div className="card-state" ref={stateElRef} />
            <div
              className="card-text"
              dangerouslySetInnerHTML={{ __html: renderText(cue.text, vars) }}
            />
            <div className="card-btns">
              {isPhase ? (
                <button className="go-btn" ref={gbRef} onClick={onPhaseBtn}>
                  {engState.started ? 'GO ▸' : '▶ Start'}
                </button>
              ) : (
                cue.sets.map(s => (
                  <div key={s.name} className="vgroup">
                    <span className="vglabel">{s.name}</span>
                    {s.options.map(opt => (
                      <button
                        key={opt}
                        className={vars[s.name]?.value === opt ? 'on' : ''}
                        onClick={() => onSetVar(s.name, opt)}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                ))
              )}
              <button className="done-btn" onClick={() => onDone(i)} disabled={doneDisabled}>Done</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
