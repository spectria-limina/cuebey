import { useRef, useEffect } from 'react';
import { fmtClean, trimNum } from '../format.js';
import { renderText } from '../parser.js';

export default function Timeline({
  csvText, onCsvChange, parseStatus, metaText,
  cues, vars, activeTab, onTabChange,
  onLoad, onDownload, onCopy, onSeek,
  registerRenderRow,
}) {
  const fileRef = useRef(null);

  return (
    <section className="editor">
      <div className="editor-head">
        <div className="tabs">
          <button
            className={'tab' + (activeTab === 'source' ? ' on' : '')}
            onClick={() => onTabChange('source')}
          >Source</button>
          <button
            className={'tab' + (activeTab === 'rendered' ? ' on' : '')}
            onClick={() => onTabChange('rendered')}
          >Rendered</button>
        </div>
        <div className="meta">{metaText}</div>
      </div>

      <div className={'pane' + (activeTab === 'source' ? ' on' : '')}>
        <textarea
          value={csvText}
          onChange={e => onCsvChange(e.target.value)}
          spellCheck={false}
        />
        <div className={'parsebar ' + (parseStatus.ok ? 'ok' : 'err')}>
          {parseStatus.msg}
        </div>
        <div className="io">
          <button className="ghost" onClick={() => fileRef.current?.click()}>Load CSV</button>
          <button className="ghost" onClick={onDownload}>Download</button>
          <button className="ghost" onClick={onCopy}>Copy</button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            hidden
            onChange={e => { const f = e.target.files[0]; if (f) onLoad(f); }}
          />
        </div>
        <div className="help">
          Columns: <code>time, standby, warn, remain, type, text, set, options</code> · times <b>H:MM:SS</b> (offset subtracted); durations in seconds.<br />
          <code>standby</code> blue lead-in · <code>warn</code> orange + bar (default 2) · <code>remain</code> green hold after cue.<br />
          <code>type</code> = <code>call</code> · <code>note</code> · <code>phase</code> (clock holds, press GO).<br />
          Variables: <code>set</code>=<code>cleave;tether</code> with <code>options</code>=<code>left|right;near|far</code>. In text: <code>{'{var}'}</code>, <code>{'{cleave:left=right}'}</code>.<br />
          Click a row in <b>Rendered</b> while stopped to rehearse from ~5s before it.
        </div>
      </div>

      <div className={'pane' + (activeTab === 'rendered' ? ' on' : '')}>
        <div className="rlist">
          {cues.map((c, i) => (
            <RenderedRow
              key={i}
              i={i}
              cue={c}
              vars={vars}
              onSeek={onSeek}
              registerRenderRow={registerRenderRow}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function RenderedRow({ i, cue, vars, onSeek, registerRenderRow }) {
  const rowRef = useRef(null);

  useEffect(() => {
    registerRenderRow(i, { row: rowRef.current });
  }, [i, registerRenderRow]);

  const badges = [];
  if (cue.standby != null) badges.push('S' + trimNum(cue.standby));
  if (cue.warn != null) badges.push('W' + trimNum(cue.warn));
  if (cue.remain != null) badges.push('R' + trimNum(cue.remain));

  return (
    <div
      ref={rowRef}
      className={'rrow' + (cue.type === 'note' ? ' me' : '') + (cue.type === 'phase' ? ' ph' : '')}
      onClick={() => onSeek(i)}
    >
      <div className="rt">{fmtClean(cue.effTime)}</div>
      <div className="rc" dangerouslySetInnerHTML={{ __html: renderText(cue.text, vars) }} />
      {badges.length > 0 && <div className="rbadge">{badges.join(' ')}</div>}
      {cue.type === 'note' && <div className="rtag">NOTE</div>}
      {cue.type === 'phase' && <div className="rtag">PHASE</div>}
      {cue.sets.length > 0 && (
        <div className="rvtag">set {cue.sets.map(s => s.name).join(', ')}</div>
      )}
    </div>
  );
}
