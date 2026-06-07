import { useRef, useEffect } from 'react';
import type { VarsRecord, VarState, EngStateSnapshot, VarCardDomRefs } from '../types.ts';

interface VariablesProps {
  vars: VarsRecord;
  conflicts: string[];
  engState: EngStateSnapshot;
  onSetVar: (name: string, val: string) => void;
  registerVarRef: (idx: number, refs: VarCardDomRefs) => void;
}

export default function Variables({ vars, conflicts, engState, onSetVar, registerVarRef }: VariablesProps) {
  const varList = Object.values(vars)
    .filter(v => v && typeof v === 'object' && v.options && v.options.length)
    .sort((a, b) => a.first - b.first);

  const isEmpty = varList.length === 0;

  return (
    <aside className="vars">
      <div className="vars-head">
        <span className="d" />
        Variables
      </div>
      <div className="vars-body">
        {conflicts.length > 0 && (
          <div className="vars-conflict-warn">
            ⚠ Conflicting options for: {conflicts.join(', ')}
          </div>
        )}
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

interface VarCardProps {
  v: VarState;
  idx: number;
  onSetVar: (name: string, val: string) => void;
  registerVarRef: (idx: number, refs: VarCardDomRefs) => void;
}

function VarCard({ v, idx, onSetVar, registerVarRef }: VarCardProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    registerVarRef(idx, { slot: slotRef.current, card: cardRef.current, v });
  }, [idx, registerVarRef, v]);

  const displayName = v.label && v.label !== v.name ? v.label : v.name;

  return (
    <div className="slot" ref={slotRef}>
      <div className="cardwrap">
        <div className="vcard" ref={cardRef}>
          <div className="vname">
            <span className="vlabel">{displayName}</span>
            <span className={'cur' + (v.value == null ? ' none' : '')}>
              {v.value == null ? 'unset' : (v.labels?.[v.options.indexOf(v.value)] ?? v.value)}
            </span>
          </div>
          <div className="vopts">
            {v.options.map((opt, ki) => (
              <button
                key={opt}
                className={v.value === opt ? 'on' : ''}
                onClick={() => onSetVar(v.name, opt)}
              >
                {v.labels?.[ki] ?? opt}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
