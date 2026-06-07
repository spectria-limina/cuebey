import { useRef, useEffect } from 'react';

export default function Variables({ vars, engState, onSetVar, registerVarRef }) {
  const varList = Object.values(vars)
    .filter(v => v.options.length)
    .sort((a, b) => a.first - b.first);

  const isEmpty = varList.length === 0;

  return (
    <aside className="vars">
      <div className="vars-head">
        <span className="d" />
        Variables
      </div>
      <div className="vars-body">
        {isEmpty ? (
          <div className="vars-empty">
            {engState.started
              ? 'No active variables right now.'
              : 'Active variables appear here during the fight.'}
          </div>
        ) : (
          varList.map((v, idx) => (
            <VarCard
              key={v.name}
              v={v}
              idx={idx}
              onSetVar={onSetVar}
              registerVarRef={registerVarRef}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function VarCard({ v, idx, onSetVar, registerVarRef }) {
  const slotRef = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => {
    registerVarRef(idx, { slot: slotRef.current, card: cardRef.current, v });
  }, [idx, registerVarRef, v]);

  return (
    <div className="slot" ref={slotRef}>
      <div className="cardwrap">
        <div className="vcard" ref={cardRef}>
          <div className="vname">
            <span>{v.name}</span>
            <span className={'cur' + (v.value == null ? ' none' : '')}>
              {v.value == null ? 'unset' : v.value}
            </span>
          </div>
          <div className="vopts">
            {v.options.map(opt => (
              <button
                key={opt}
                className={v.value === opt ? 'on' : ''}
                onClick={() => onSetVar(v.name, opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
