// vessel-ui.jsx — Vessel host design system: tokens + shared components.
// All components are theme-driven via a `t` (tokens) object so light/dark
// is just a token swap. Exported to window for the app/canvas file.

/* ---------------------------------------------------------------- tokens */
const vesselLight = {
  name: 'light',
  // host chrome — kept near-invisible, a hair off pure white
  bar: '#f5f5f4',
  barBorder: '#e4e4e1',
  appBg: '#f5f5f4',
  // tool sandbox surface — distinct (brighter) from chrome
  toolBg: '#ffffff',
  toolHeader: '#fbfbfa',
  well: '#ffffff',
  wellBorder: '#e0e0dd',
  wellShadow: 'inset 0 1px 0 rgba(0,0,0,0.04), inset 0 2px 5px rgba(0,0,0,0.025)',
  toolTop: 'inset 0 1px 0 rgba(0,0,0,0.025)',
  // ink
  text: '#26282b',
  textMid: '#5b5e63',
  textMuted: '#8a8d92',
  hair: '#e9e9e6',
  hairStrong: '#dededa',
  // controls
  field: '#ffffff',
  fieldBorder: '#dadad7',
  fieldText: '#26282b',
  chip: '#f1f1ef',
  // accent — slate-blue, used sparingly
  accent: 'oklch(0.55 0.09 230)',
  accentSoft: 'oklch(0.55 0.09 230 / 0.10)',
  accentBorder: 'oklch(0.55 0.09 230 / 0.30)',
  onAccent: '#ffffff',
  ok: 'oklch(0.58 0.07 155)',
  closeHover: '#e2453a',
  winBorder: '#d0d0cc',
  winShadow: '0 18px 50px -12px rgba(20,22,28,0.28), 0 4px 12px rgba(20,22,28,0.10)',
};

const vesselDark = {
  name: 'dark',
  bar: '#26282b',
  barBorder: '#34373b',
  appBg: '#26282b',
  toolBg: '#1c1e21',
  toolHeader: '#212327',
  well: '#1c1e21',
  wellBorder: '#34373b',
  wellShadow: 'inset 0 1px 0 rgba(0,0,0,0.25), inset 0 2px 6px rgba(0,0,0,0.20)',
  toolTop: 'inset 0 1px 0 rgba(0,0,0,0.22)',
  text: '#e7e8ea',
  textMid: '#aeb1b6',
  textMuted: '#7e8186',
  hair: '#303338',
  hairStrong: '#3a3d42',
  field: '#26282b',
  fieldBorder: '#3c3f44',
  fieldText: '#e7e8ea',
  chip: '#2e3135',
  accent: 'oklch(0.70 0.10 230)',
  accentSoft: 'oklch(0.70 0.10 230 / 0.16)',
  accentBorder: 'oklch(0.70 0.10 230 / 0.40)',
  onAccent: '#16181b',
  ok: 'oklch(0.72 0.09 155)',
  closeHover: '#e2453a',
  winBorder: '#000000',
  winShadow: '0 18px 50px -12px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.35)',
};

const UIFONT = '"Geist", "Segoe UI", system-ui, sans-serif';
const MONO = '"Geist Mono", ui-monospace, "SF Mono", monospace';

/* ----------------------------------------------------------------- icons */
// Minimal stroked glyphs, currentColor, 1.5 stroke. Simple shapes only.
function Ico({ d, size = 16, sw = 1.5, fill, children, vb = 24, style }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} fill={fill || 'none'}
      stroke={fill ? 'none' : 'currentColor'} strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
      {d ? <path d={d} /> : children}
    </svg>
  );
}
const IconMin = (p) => <Ico {...p} vb={12} sw={1.1}><line x1="2.5" y1="6" x2="9.5" y2="6" /></Ico>;
const IconMax = (p) => <Ico {...p} vb={12} sw={1.1}><rect x="2.6" y="2.6" width="6.8" height="6.8" rx="0.6" /></Ico>;
const IconClose = (p) => <Ico {...p} vb={12} sw={1.1}><line x1="3" y1="3" x2="9" y2="9" /><line x1="9" y1="3" x2="3" y2="9" /></Ico>;
const IconCheck = (p) => <Ico {...p} d="M5 12.5l4.2 4.2L19 7" />;
const IconLock = (p) => <Ico {...p}><rect x="5" y="11" width="14" height="9" rx="1.6" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Ico>;
const IconDots = (p) => <Ico {...p} fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></Ico>;
const IconFolder = (p) => <Ico {...p} d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2H19.5A1.5 1.5 0 0 1 21 9.7v8.8A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5z" />;
const IconChevR = (p) => <Ico {...p} d="M9 5l7 7-7 7" />;
const IconGlobe = (p) => <Ico {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.3 2.4 14.7 0 17M12 3.5c-2.4 2.3-2.4 14.7 0 17" /></Ico>;
const IconArrow = (p) => <Ico {...p} d="M5 12h13M12 5l7 7-7 7" />;

/* ------------------------------------------------------------ primitives */
function Dot({ color, size = 7 }) {
  return <span style={{ width: size, height: size, borderRadius: '50%', background: color, flex: '0 0 auto', display: 'inline-block' }} />;
}

// signed / unsigned indicator
function TrustMark({ t, signed, compact }) {
  if (signed) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, height: 18,
        padding: compact ? '0 5px 0 4px' : '0 7px 0 5px', borderRadius: 4,
        background: t.accentSoft, color: t.accent, border: `1px solid ${t.accentBorder}`,
        fontSize: 11, fontWeight: 500, letterSpacing: '0.01em', whiteSpace: 'nowrap',
      }}>
        <IconCheck size={11} sw={2.2} />signed
      </span>
    );
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, height: 18,
      padding: '0 7px', borderRadius: 4, background: 'transparent',
      color: t.textMuted, border: `1px dashed ${t.hairStrong}`,
      fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
    }}>unsigned</span>
  );
}

function Button({ t, kind = 'secondary', children, onClick, icon, full, style }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 36, padding: '0 16px', borderRadius: 7, font: `500 13.5px/1 ${UIFONT}`,
    cursor: 'pointer', whiteSpace: 'nowrap', width: full ? '100%' : 'auto',
    transition: 'background .12s, border-color .12s, color .12s', userSelect: 'none',
  };
  const kinds = {
    primary: { background: t.accent, color: t.onAccent, border: '1px solid transparent' },
    secondary: { background: t.field, color: t.text, border: `1px solid ${t.fieldBorder}` },
    ghost: { background: 'transparent', color: t.textMid, border: '1px solid transparent' },
    danger: { background: 'transparent', color: t.text, border: `1px solid ${t.fieldBorder}` },
  };
  return (
    <button onClick={onClick} style={{ ...base, ...kinds[kind], ...style }}
      onMouseEnter={(e) => { if (kind === 'secondary' || kind === 'danger') e.currentTarget.style.background = t.chip; if (kind === 'ghost') e.currentTarget.style.background = t.chip; }}
      onMouseLeave={(e) => { if (kind !== 'primary') e.currentTarget.style.background = kind === 'ghost' ? 'transparent' : t.field; }}>
      {icon}{children}
    </button>
  );
}

// Windows-style caption button
function CaptionBtn({ t, kind }) {
  const [hov, setHov] = React.useState(false);
  const isClose = kind === 'close';
  return (
    <div
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        width: 46, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: isClose && hov ? '#fff' : t.textMid,
        background: hov ? (isClose ? t.closeHover : 'rgba(125,125,125,0.14)') : 'transparent',
        transition: 'background .1s, color .1s', cursor: 'default',
      }}>
      {kind === 'min' && <IconMin />}
      {kind === 'max' && <IconMax />}
      {kind === 'close' && <IconClose />}
    </div>
  );
}

/* --------------------------------------------------------------- TitleBar */
// Variant B: the tool name is centered in the window. The host's thin top bar
// IS the window titlebar (integrated PWA chrome); caption controls inset right.
function TitleBar({ t, mode, toolName }) {
  return (
    <div style={{
      height: 40, flex: '0 0 40px', display: 'flex', alignItems: 'stretch',
      background: t.bar, borderBottom: `1px solid ${t.barBorder}`,
      font: `13px ${UIFONT}`, color: t.text, userSelect: 'none', position: 'relative',
    }}>
      {/* centered tool identity — absolute so it's centered in the full window */}
      {mode === 'tool' && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 9, pointerEvents: 'none', zIndex: 0,
        }}>
          <TrustMark t={t} signed compact />
          <span style={{ fontWeight: 540, fontSize: 13 }}>{toolName}</span>
        </div>
      )}

      {/* left cluster */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', minWidth: 0, zIndex: 1 }}>
        <VesselGlyph t={t} />
        {mode === 'launcher' && <span style={{ fontWeight: 600, letterSpacing: '0.01em', fontSize: 13 }}>Vessel</span>}
      </div>

      <div style={{ flex: 1 }} />

      {/* right cluster — status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingRight: 8, zIndex: 1 }}>
        {mode === 'launcher' ? (
          <span style={{ font: `11.5px ${MONO}`, color: t.textMuted, letterSpacing: '-0.01em' }}>
            runtime cached · offline ready
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: `12px ${UIFONT}`, color: t.textMid }}>
            <Dot color={t.ok} size={6} />Saved
          </span>
        )}
      </div>

      {/* caption controls */}
      <div style={{ display: 'flex', alignItems: 'stretch', zIndex: 1 }}>
        <CaptionBtn t={t} kind="min" />
        <CaptionBtn t={t} kind="max" />
        <CaptionBtn t={t} kind="close" />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- MenuBar */
// Thin desktop menu strip. Reinforces "real installable host" without weight.
function buildMenus(hasTool, appearance) {
  return [
    {
      id: 'file', label: 'File', items: [
        { id: 'new', label: 'New Window', shortcut: 'Ctrl+N' },
        { id: 'open', label: 'Open…', shortcut: 'Ctrl+O' },
        { id: 'recent', label: 'Open Recent', submenu: RECENTS.map((r) => ({ id: 'open-recent', label: r.name, payload: r })) },
        { sep: true },
        { id: 'save', label: 'Save', shortcut: 'Ctrl+S', disabled: !hasTool },
        { id: 'saveas', label: 'Save a Copy…', shortcut: 'Ctrl+Shift+S', disabled: !hasTool },
        { id: 'reveal', label: 'Reveal in Folder', disabled: !hasTool },
        { sep: true },
        { id: 'settings', label: 'Settings…', shortcut: 'Ctrl+,' },
        { sep: true },
        { id: 'close', label: 'Close Tool', shortcut: 'Ctrl+W', disabled: !hasTool },
      ],
    },
    {
      id: 'view', label: 'View', items: [
        {
          id: 'appearance', label: 'Appearance', submenu: [
            { id: 'set-light', label: 'Light', check: appearance === 'light' },
            { id: 'set-dark', label: 'Dark', check: appearance === 'dark' },
            { id: 'set-system', label: 'Use System Setting', check: appearance === 'system' },
          ],
        },
      ],
    },
    {
      id: 'help', label: 'Help', items: [
        { id: 'about', label: 'About Vessel' },
        { id: 'runtime', label: 'Runtime Status' },
        { id: 'docs', label: 'Documentation' },
      ],
    },
  ];
}

function MenuBar({ t, hasTool, appearance, onAction }) {
  const [open, setOpen] = React.useState(null);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(null); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const menus = buildMenus(hasTool, appearance);
  return (
    <div ref={ref} style={{
      height: 30, flex: '0 0 30px', display: 'flex', alignItems: 'stretch',
      background: t.bar, borderBottom: `1px solid ${t.barBorder}`,
      padding: '0 4px', position: 'relative', zIndex: 30, userSelect: 'none',
    }}>
      {menus.map((m) => {
        const isOpen = open === m.id;
        return (
          <div key={m.id} style={{ position: 'relative', display: 'flex' }}>
            <button
              onClick={() => setOpen(isOpen ? null : m.id)}
              onMouseEnter={() => { if (open && open !== m.id) setOpen(m.id); }}
              style={{
                border: 'none', background: isOpen ? t.chip : 'transparent', color: t.textMid,
                font: `12.5px ${UIFONT}`, padding: '0 10px', cursor: 'default', borderRadius: 5,
                margin: '4px 1px', transition: 'background .1s, color .1s',
              }}
              onMouseOver={(e) => { if (!isOpen) e.currentTarget.style.color = t.text; }}
              onMouseOut={(e) => { if (!isOpen) e.currentTarget.style.color = t.textMid; }}>
              {m.label}
            </button>
            {isOpen && (
              <MenuDropdown t={t} items={m.items}
                onAction={(id, payload) => { setOpen(null); onAction(id, payload); }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function MenuDropdown({ t, items, onAction, sub }) {
  const [openSub, setOpenSub] = React.useState(null);
  return (
    <div style={{
      position: 'absolute', top: sub ? -5 : '100%', left: sub ? '100%' : 0, marginTop: sub ? 0 : 3,
      marginLeft: sub ? 2 : 0, minWidth: sub ? 200 : 224, background: t.toolBg,
      border: `1px solid ${t.hairStrong}`, borderRadius: 9, padding: 5, boxShadow: t.winShadow, zIndex: 60,
    }}>
      {items.map((it, i) => {
        if (it.sep) return <div key={i} style={{ height: 1, background: t.hair, margin: '5px 6px' }} />;
        const hasSub = !!it.submenu;
        return (
          <div key={i} style={{ position: 'relative' }} onMouseEnter={() => setOpenSub(hasSub ? i : null)}>
            <button
              disabled={it.disabled}
              onClick={() => { if (!hasSub && !it.disabled) onAction(it.id, it.payload); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left',
                padding: '7px 10px', border: 'none', background: 'transparent',
                cursor: 'default', borderRadius: 6, opacity: it.disabled ? 0.45 : 1,
                color: it.disabled ? t.textMuted : t.text, font: `13px ${UIFONT}`,
              }}
              onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = t.chip; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
              {it.check !== undefined && (
                <span style={{ width: 13, flex: '0 0 auto', color: t.accent, display: 'flex' }}>
                  {it.check ? <IconCheck size={13} sw={2.4} /> : null}
                </span>
              )}
              <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{it.label}</span>
              {it.shortcut && <span style={{ font: `11px ${MONO}`, color: t.textMuted }}>{it.shortcut}</span>}
              {hasSub && <span style={{ color: t.textMuted, marginRight: -2 }}><IconChevR size={13} /></span>}
            </button>
            {hasSub && openSub === i && (
              <MenuDropdown t={t} items={it.submenu} onAction={onAction} sub />
            )}
          </div>
        );
      })}
    </div>
  );
}

// app icon — a simple "vessel": rounded container with a fill line. Simple shapes only.
function VesselGlyph({ t, size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" style={{ flex: '0 0 auto' }}>
      <rect x="3.5" y="2.5" width="13" height="15" rx="3" fill="none" stroke={t.accent} strokeWidth="1.6" />
      <path d="M3.5 11.5 H16.5" stroke={t.accent} strokeWidth="1.6" />
      <rect x="3.5" y="11.5" width="13" height="6" rx="0" fill={t.accentSoft} />
    </svg>
  );
}

/* ---------------------------------------------------------- Recent list */
function RecentRow({ t, name, signed, time, onOpen }) {
  const [hov, setHov] = React.useState(false);
  return (
    <button onClick={onOpen} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
        padding: '11px 12px', borderRadius: 9, border: '1px solid transparent',
        background: hov ? t.toolBg : 'transparent', cursor: 'pointer',
        boxShadow: hov ? `0 0 0 1px ${t.hair}` : 'none', transition: 'background .12s, box-shadow .12s',
        font: UIFONT,
      }}>
      <span style={{
        width: 34, height: 34, borderRadius: 8, flex: '0 0 auto', background: t.chip,
        border: `1px solid ${t.hair}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
        font: `600 11px ${MONO}`, color: t.textMid,
      }}>.v</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
        <div style={{ marginTop: 3 }}><TrustMark t={t} signed={signed} compact /></div>
      </div>
      <span style={{ font: `11.5px ${MONO}`, color: t.textMuted, flex: '0 0 auto', letterSpacing: '-0.01em' }}>{time}</span>
      <span style={{ color: hov ? t.textMid : t.textMuted, flex: '0 0 auto', opacity: hov ? 1 : 0.45, transition: 'opacity .12s' }}><IconChevR size={15} /></span>
    </button>
  );
}

const RECENTS = [
  { name: 'Substation Battery Sizing', signed: true, time: '2h ago' },
  { name: 'Cable Ampacity — IEC 60287', signed: true, time: 'yesterday' },
  { name: 'Relay Coordination Notes', signed: false, time: '3d ago' },
];

/* ------------------------------------------------------------- Launcher */
function LauncherBody({ t, onOpen }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: t.appBg, padding: '0 40px' }}>
      <div style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* empty state */}
        <div style={{
          width: 64, height: 64, borderRadius: 16, border: `1px solid ${t.hairStrong}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.toolBg,
        }}>
          <VesselGlyph t={t} size={30} />
        </div>
        <div style={{ marginTop: 20, fontSize: 16, fontWeight: 560, color: t.text }}>No tool open</div>
        <div style={{ marginTop: 6, fontSize: 13, color: t.textMuted, textAlign: 'center', lineHeight: 1.5 }}>
          Open a <span style={{ font: `12.5px ${MONO}`, color: t.textMid }}>.vessel</span> file to run its tool. Each file carries its own app and data.
        </div>
        <div style={{ marginTop: 22 }}>
          <Button t={t} kind="primary" icon={<IconFolder size={16} />} onClick={onOpen}>Open a .vessel…</Button>
        </div>
        <div style={{ marginTop: 11, fontSize: 12, color: t.textMuted }}>or drop a file onto this window</div>

        {/* recent */}
        <div style={{ width: '100%', marginTop: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px 8px' }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: t.textMuted }}>Recent</span>
            <span style={{ flex: 1, height: 1, background: t.hair }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {RECENTS.map((r) => <RecentRow key={r.name} t={t} {...r} onOpen={onOpen} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Boot */
function BootBody({ t }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: t.appBg, gap: 18 }}>
      <VesselGlyph t={t} size={34} />
      <div style={{ fontSize: 14.5, fontWeight: 540, color: t.text }}>Starting runtime…</div>
      <div style={{ width: 240, height: 3, borderRadius: 3, background: t.hair, overflow: 'hidden', position: 'relative' }}>
        <div className="vsl-indeterminate" style={{ position: 'absolute', top: 0, bottom: 0, width: '40%', borderRadius: 3, background: t.accent }} />
      </div>
      <div style={{ font: `11.5px ${MONO}`, color: t.textMuted, letterSpacing: '-0.01em' }}>python 3.12 · 14.2 MB · first launch only</div>
    </div>
  );
}

/* --------------------------------------------------- Tool sandbox (well) */
// Boundary C: surface-shift only. The tool surface is a distinct (brighter /
// in dark, deeper) shade than the host chrome; the menu-bar divider above does
// the separating. No recessed well, no extra frame — the lightest possible cue.
function Sandbox({ t, children }) {
  return (
    <div style={{
      flex: 1, minHeight: 0, background: t.toolBg, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', boxShadow: t.toolTop,
    }}>
      {children}
    </div>
  );
}

function Field({ t, label, unit, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={{ fontSize: 12, color: t.textMid, fontWeight: 500 }}>{label}{unit ? <span style={{ color: t.textMuted, font: `11px ${MONO}` }}>  {unit}</span> : null}</span>
      {children}
    </label>
  );
}

function NumInput({ t, value, onChange, suffix }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 38, border: `1px solid ${t.fieldBorder}`, borderRadius: 7, background: t.field, overflow: 'hidden' }}>
      <input value={value} onChange={(e) => onChange && onChange(e.target.value)}
        inputMode="decimal"
        style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', padding: '0 12px', font: `14px ${MONO}`, color: t.fieldText, letterSpacing: '-0.01em' }} />
      {suffix && <span style={{ font: `12px ${MONO}`, color: t.textMuted, padding: '0 12px 0 0' }}>{suffix}</span>}
    </div>
  );
}

function Seg({ t, options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 0, border: `1px solid ${t.fieldBorder}`, borderRadius: 7, overflow: 'hidden', height: 38, background: t.field }}>
      {options.map((o, i) => {
        const on = o === value;
        return (
          <button key={o} onClick={() => onChange && onChange(o)} style={{
            flex: 1, border: 'none', borderLeft: i ? `1px solid ${t.fieldBorder}` : 'none', cursor: 'pointer',
            background: on ? t.accentSoft : 'transparent', color: on ? t.accent : t.textMid,
            font: `13px ${MONO}`, fontWeight: on ? 600 : 400, letterSpacing: '-0.01em',
          }}>{o}</button>
        );
      })}
    </div>
  );
}

// The example tool's OWN UI. Visually distinct from host chrome.
function BatteryTool({ t, onNeedNetwork }) {
  const [voltage, setVoltage] = React.useState('125');
  const [load, setLoad] = React.useState('110');
  const [duty, setDuty] = React.useState('150');
  const [margin, setMargin] = React.useState('12.5');

  const n = (v) => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
  const aging = 1.25;
  const hours = n(duty) / 60;
  const ah = n(load) * hours * aging * (1 + n(margin) / 100);
  const cells = Math.round(n(voltage) / 2.08);
  const minTerm = (n(voltage) * 0.84).toFixed(0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', font: UIFONT, color: t.text }}>
      {/* tool's own header — different texture from host bar */}
      <div style={{ padding: '16px 22px', borderBottom: `1px solid ${t.hair}`, background: t.toolHeader, display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>Substation Battery Sizing</span>
        <span style={{ font: `11.5px ${MONO}`, color: t.textMuted }}>IEEE 485 · lead-acid</span>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 360px', minHeight: 0 }}>
        {/* inputs */}
        <div style={{ padding: '26px 28px', display: 'flex', flexDirection: 'column', gap: 20, overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ fontSize: 12, color: t.textMid, fontWeight: 500 }}>System voltage<span style={{ color: t.textMuted, font: `11px ${MONO}` }}>  VDC</span></span>
            <Seg t={t} options={['48', '125', '250']} value={voltage} onChange={setVoltage} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            <Field t={t} label="Connected load" unit="A"><NumInput t={t} value={load} onChange={setLoad} suffix="A" /></Field>
            <Field t={t} label="Duty cycle" unit="min"><NumInput t={t} value={duty} onChange={setDuty} suffix="min" /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            <Field t={t} label="Design margin" unit="%"><NumInput t={t} value={margin} onChange={setMargin} suffix="%" /></Field>
            <Field t={t} label="Aging factor"><div style={{ display: 'flex', alignItems: 'center', height: 38, padding: '0 12px', border: `1px dashed ${t.fieldBorder}`, borderRadius: 7, font: `14px ${MONO}`, color: t.textMuted }}>{aging.toFixed(2)} ×</div></Field>
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 10, paddingTop: 6 }}>
            <Button t={t} kind="secondary" icon={<IconGlobe size={15} />} onClick={onNeedNetwork}>Sync field temperature</Button>
            <span style={{ font: `11px ${MONO}`, color: t.textMuted }}>needs network</span>
          </div>
        </div>

        {/* results */}
        <div style={{ borderLeft: `1px solid ${t.hair}`, background: t.toolHeader, padding: '26px 26px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: t.textMuted }}>Required capacity</span>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ font: `600 52px ${MONO}`, letterSpacing: '-0.02em', color: t.text, lineHeight: 1 }}>{ah.toFixed(0)}</span>
              <span style={{ font: `18px ${MONO}`, color: t.textMid }}>Ah</span>
            </div>
            <div style={{ marginTop: 8, font: `11.5px ${MONO}`, color: t.textMuted }}>positive plate, 8-hour rate @ 25 °C</div>
          </div>
          <div style={{ height: 1, background: t.hair }} />
          <ResRow t={t} k="Cells in series" v={String(cells)} />
          <ResRow t={t} k="Min terminal V" v={`${minTerm} V`} />
          <ResRow t={t} k="Backup runtime" v={`${hours.toFixed(2)} h`} />
          <ResRow t={t} k="Uncorrected" v={`${(n(load) * hours).toFixed(0)} Ah`} />
        </div>
      </div>
    </div>
  );
}

function ResRow({ t, k, v }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 12.5, color: t.textMid }}>{k}</span>
      <span style={{ font: `13px ${MONO}`, color: t.text, fontWeight: 500, letterSpacing: '-0.01em' }}>{v}</span>
    </div>
  );
}

/* ----------------------------------------------------- Preferences */
function Toggle({ t, on, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: 38, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', flex: '0 0 auto',
      background: on ? t.accent : t.hairStrong, position: 'relative', transition: 'background .15s',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%',
        background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.3)',
      }} />
    </button>
  );
}

function SegText({ t, options, value, onChange }) {
  return (
    <div style={{ display: 'flex', border: `1px solid ${t.fieldBorder}`, borderRadius: 8, overflow: 'hidden', height: 34, background: t.field }}>
      {options.map((o, i) => {
        const on = o.id === value;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} style={{
            flex: 1, border: 'none', borderLeft: i ? `1px solid ${t.fieldBorder}` : 'none', cursor: 'pointer',
            background: on ? t.accentSoft : 'transparent', color: on ? t.accent : t.textMid,
            font: `12.5px ${UIFONT}`, fontWeight: on ? 600 : 500,
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

function PrefRow({ t, label, hint, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 0', borderTop: `1px solid ${t.hair}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: t.text }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 3, lineHeight: 1.45 }}>{hint}</div>}
      </div>
      <div style={{ flex: '0 0 auto' }}>{children}</div>
    </div>
  );
}

// Settings / Preferences panel — where appearance lives, plus runtime/security.
function Preferences({ t, appearance, onAppearance, prefs, onToggle, onClose }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(15,17,21,0.34)', backdropFilter: 'blur(1.5px)' }} />
      <div style={{
        position: 'relative', width: 480, maxHeight: '86%', background: t.toolBg, borderRadius: 12,
        border: `1px solid ${t.hairStrong}`, boxShadow: t.winShadow, overflow: 'hidden', font: UIFONT,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 18px', borderBottom: `1px solid ${t.hair}` }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: t.text }}>Settings</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', color: t.textMid, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseEnter={(e) => e.currentTarget.style.background = t.chip} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <IconClose size={13} sw={1.6} />
          </button>
        </div>
        <div style={{ padding: '6px 22px 8px' }}>
          <div style={{ padding: '16px 0 4px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: t.textMuted, marginBottom: 12 }}>Appearance</div>
            <SegText t={t} value={appearance} onChange={onAppearance}
              options={[{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }, { id: 'system', label: 'System' }]} />
          </div>
          <div style={{ marginTop: 14, marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: t.textMuted, marginBottom: 2 }}>Runtime &amp; security</div>
            <PrefRow t={t} label="Keep runtime cached for offline use" hint="Tools open without a network connection. Uses ~14 MB.">
              <Toggle t={t} on={prefs.cache} onClick={() => onToggle('cache')} />
            </PrefRow>
            <PrefRow t={t} label="Ask before a tool accesses the network" hint="Prompt for each new domain a tool tries to reach.">
              <Toggle t={t} on={prefs.warnNet} onClick={() => onToggle('warnNet')} />
            </PrefRow>
            <PrefRow t={t} label="Open each tool in its own window" hint="Matches the double-click-to-open behavior of .vessel files.">
              <Toggle t={t} on={prefs.multiWin} onClick={() => onToggle('multiWin')} />
            </PrefRow>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderTop: `1px solid ${t.hair}`, background: t.toolHeader }}>
          <span style={{ font: `11px ${MONO}`, color: t.textMuted }}>Vessel 0.4.1 · runtime python 3.12</span>
          <div style={{ flex: 1 }} />
          <Button t={t} kind="primary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------- Permission modal */
function PermissionModal({ t, onChoice }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,17,21,0.34)', backdropFilter: 'blur(1.5px)' }} />
      <div style={{
        position: 'relative', width: 440, background: t.toolBg, borderRadius: 12,
        border: `1px solid ${t.hairStrong}`, boxShadow: t.winShadow, overflow: 'hidden', font: UIFONT,
      }}>
        <div style={{ padding: '24px 26px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 38, height: 38, borderRadius: 9, background: t.accentSoft, border: `1px solid ${t.accentBorder}`, color: t.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}><IconGlobe size={19} /></span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: t.text }}>Allow network access?</div>
              <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>Substation Battery Sizing</div>
            </div>
          </div>

          <p style={{ margin: '18px 0 12px', fontSize: 13, lineHeight: 1.55, color: t.textMid }}>
            This tool wants to reach a single domain to fetch ambient temperature. It cannot connect to anything else.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderRadius: 8, background: t.chip, border: `1px solid ${t.hair}` }}>
            <Dot color={t.ok} size={7} />
            <span style={{ font: `13px ${MONO}`, color: t.text, letterSpacing: '-0.01em' }}>api.weather.gov</span>
            <span style={{ marginLeft: 'auto', font: `11px ${MONO}`, color: t.textMuted }}>HTTPS only</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 14, color: t.textMid }}>
            <IconLock size={13} />
            <span style={{ fontSize: 12 }}>Signed by <span style={{ fontWeight: 600, color: t.text }}>Westgrid Instruments</span> · verified publisher</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px', borderTop: `1px solid ${t.hair}`, background: t.toolHeader }}>
          <Button t={t} kind="ghost" onClick={() => onChoice('deny')}>Deny</Button>
          <div style={{ flex: 1 }} />
          <Button t={t} kind="secondary" onClick={() => onChoice('once')}>Allow once</Button>
          <Button t={t} kind="primary" onClick={() => onChoice('always')}>Allow always</Button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------- Window frame */
// Windows 11-ish app window: rounded, hairline border, sits on canvas.
function AppWindow({ t, children, w = 1100, h = 720 }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column',
      background: t.appBg, border: `1px solid ${t.winBorder}`, boxShadow: t.winShadow,
      position: 'relative', fontFamily: UIFONT,
    }}>
      {children}
    </div>
  );
}

Object.assign(window, {
  vesselLight, vesselDark, UIFONT, MONO,
  Button, TitleBar, MenuBar, TrustMark, Dot, VesselGlyph,
  LauncherBody, BootBody, Sandbox, BatteryTool, Preferences,
  PermissionModal, AppWindow, RECENTS,
  IconFolder, IconGlobe, IconLock, IconArrow,
});
