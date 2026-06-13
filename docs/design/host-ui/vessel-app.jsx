// vessel-app.jsx — interactive Vessel host + design-canvas composition.

const { useState, useCallback } = React;

/* ----------------------------------------------- the live host app */
// screen: 'launcher' | 'boot' | 'tool'.  Pinnable via `pin` for static frames.
function VesselApp({ theme, pin, w, h }) {
  const interactive = !pin;
  const [appearance, setAppearance] = useState(theme || 'light'); // light | dark | system
  const resolved = appearance === 'system'
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : appearance;
  const t = resolved === 'dark' ? window.vesselDark : window.vesselLight;

  const [screen, setScreen] = useState(pin ? (pin === 'permission' ? 'tool' : pin) : 'launcher');
  const [perm, setPerm] = useState(pin === 'permission');
  const [showPrefs, setShowPrefs] = useState(false);
  const [prefs, setPrefs] = useState({ cache: true, warnNet: true, multiWin: true });
  const [toast, setToast] = useState(null);

  const flash = useCallback((msg, ms = 2400) => { setToast(msg); setTimeout(() => setToast(null), ms); }, []);
  const open = useCallback(() => {
    if (!interactive) return;
    setScreen('boot');
    setTimeout(() => setScreen('tool'), 1700);
  }, [interactive]);
  const closeTool = useCallback(() => setScreen('launcher'), []);

  const onChoice = useCallback((c) => {
    setPerm(false);
    if (c !== 'deny') flash('Connected to api.weather.gov · 11 °C', 2600);
    else flash('Network request denied', 2200);
  }, [flash]);

  const hasTool = screen === 'tool';
  const onAction = useCallback((id, payload) => {
    if (!interactive) return;
    switch (id) {
      case 'new': flash('Opened a new Vessel window'); break;
      case 'open': hasTool ? flash('Opened in a new window') : open(); break;
      case 'open-recent': hasTool ? flash(`Opened “${payload.name}” in a new window`) : open(); break;
      case 'save': flash('Saved to file'); break;
      case 'saveas': flash('Saved a copy'); break;
      case 'reveal': flash('Revealed file in folder'); break;
      case 'settings': setShowPrefs(true); break;
      case 'close': closeTool(); break;
      case 'set-light': setAppearance('light'); break;
      case 'set-dark': setAppearance('dark'); break;
      case 'set-system': setAppearance('system'); break;
      case 'about': flash('Vessel 0.4.1 · runtime python 3.12'); break;
      case 'runtime': flash('Runtime cached · offline ready · 14.2 MB'); break;
      case 'docs': flash('Opening documentation…'); break;
      default: break;
    }
  }, [interactive, hasTool, open, closeTool, flash]);

  const mode = hasTool ? 'tool' : 'launcher';

  return (
    <window.AppWindow t={t} w={w} h={h}>
      {screen !== 'boot' && (
        <>
          <window.TitleBar t={t} mode={mode} toolName="Substation Battery Sizing" />
          <window.MenuBar t={t} hasTool={hasTool} appearance={appearance} onAction={onAction} />
        </>
      )}
      {screen === 'boot' && <window.BootBody t={t} />}
      {screen === 'launcher' && <window.LauncherBody t={t} onOpen={open} />}
      {screen === 'tool' && (
        <window.Sandbox t={t}>
          <window.BatteryTool t={t} onNeedNetwork={() => interactive && setPerm(true)} />
        </window.Sandbox>
      )}

      {(perm || pin === 'permission') && <window.PermissionModal t={t} onChoice={interactive ? onChoice : () => {}} />}
      {showPrefs && (
        <window.Preferences
          t={t} appearance={appearance} onAppearance={setAppearance}
          prefs={prefs} onToggle={(k) => setPrefs((p) => ({ ...p, [k]: !p[k] }))}
          onClose={() => setShowPrefs(false)}
        />
      )}

      {toast && (
        <div style={{
          position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 80,
          background: t.text, color: t.appBg, padding: '9px 15px', borderRadius: 8,
          font: `12.5px ${window.MONO}`, letterSpacing: '-0.01em', boxShadow: t.winShadow, whiteSpace: 'nowrap',
        }}>{toast}</div>
      )}
    </window.AppWindow>
  );
}

/* ----------------------------------------------- canvas composition */
const { DesignCanvas, DCSection, DCArtboard, DCPostIt } = window;

function Frame({ children }) {
  // neutralize artboard card padding — the window fills the board
  return <div style={{ width: '100%', height: '100%' }}>{children}</div>;
}

function App() {
  return (
    <DesignCanvas>
      <DCSection id="live" title="Vessel — interactive host" subtitle="Open a .vessel → runtime boots → tool runs. The File menu drives New Window / Open / Save / Close; View ▸ Appearance and File ▸ Settings… switch light/dark. In the tool, ‘Sync field temperature’ raises the permission prompt.">
        <DCArtboard id="app" label="Live prototype · 1100×720" width={1100} height={720}>
          <Frame><VesselApp /></Frame>
        </DCArtboard>
      </DCSection>

      <DCSection id="states" title="The four states" subtitle="Each required state, pinned. Same chrome, different content — the host stays weightless so the tool is what reads.">
        <DCArtboard id="s1" label="1 · Launcher" width={1100} height={720}>
          <Frame><VesselApp pin="launcher" /></Frame>
        </DCArtboard>
        <DCArtboard id="s2" label="2 · First-run boot" width={1100} height={720}>
          <Frame><VesselApp pin="boot" /></Frame>
        </DCArtboard>
        <DCArtboard id="s3" label="3 · Tool running" width={1100} height={720}>
          <Frame><VesselApp pin="tool" /></Frame>
        </DCArtboard>
        <DCArtboard id="s4" label="4 · Permission prompt" width={1100} height={720}>
          <Frame><VesselApp pin="permission" /></Frame>
        </DCArtboard>
      </DCSection>

      <DCSection id="dark" title="Dark mode" subtitle="Same tokens, swapped. The slate-blue accent lifts a step in chroma so it holds against the dark chrome.">
        <DCArtboard id="d1" label="Launcher · dark" width={1100} height={720}>
          <Frame><VesselApp pin="launcher" theme="dark" /></Frame>
        </DCArtboard>
        <DCArtboard id="d2" label="Tool running · dark" width={1100} height={720}>
          <Frame><VesselApp pin="tool" theme="dark" /></Frame>
        </DCArtboard>
      </DCSection>

      <DCSection id="var" title="Explorations" subtitle="Chosen: top bar B (centered name) + boundary C (surface shift). Other treatments kept for reference.">
        <DCArtboard id="v-bar-b" label="Top bar · B — centered name (chosen)" width={760} height={120}>
          <BarVariant variant="b" />
        </DCArtboard>
        <DCArtboard id="v-bar-a" label="Top bar · A — left-aligned" width={760} height={120}>
          <BarVariant variant="a" />
        </DCArtboard>
        <DCArtboard id="v-bar-c" label="Top bar · C — status dot only" width={760} height={120}>
          <BarVariant variant="c" />
        </DCArtboard>
        <DCArtboard id="cue-c" label="Boundary · C — surface shift (chosen)" width={360} height={240}>
          <CueVariant variant="c" />
        </DCArtboard>
        <DCArtboard id="cue-a" label="Boundary · A — recessed well" width={360} height={240}>
          <CueVariant variant="a" />
        </DCArtboard>
        <DCArtboard id="cue-b" label="Boundary · B — hairline inset" width={360} height={240}>
          <CueVariant variant="b" />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

/* top-bar treatment variants (light) */
function BarVariant({ variant }) {
  const t = window.vesselLight;
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', background: t.appBg }}>
      <div style={{ width: '100%', border: `1px solid ${t.winBorder}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ height: 40, display: 'flex', alignItems: 'stretch', background: t.bar, borderBottom: `1px solid ${t.barBorder}`, font: `13px ${window.UIFONT}`, color: t.text }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 12px', flex: variant === 'b' ? '0 0 auto' : 1, minWidth: 0 }}>
            <window.VesselGlyph t={t} />
            {variant !== 'b' && <window.TrustMark t={t} signed compact />}
            {variant === 'a' && <span style={{ fontWeight: 540, fontSize: 13 }}>Substation Battery Sizing</span>}
            {variant === 'c' && <span style={{ fontWeight: 540, fontSize: 13 }}>Substation Battery Sizing</span>}
          </div>
          {variant === 'b' && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
              <window.TrustMark t={t} signed compact />
              <span style={{ fontWeight: 540, fontSize: 13 }}>Substation Battery Sizing</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px', flex: variant === 'b' ? '0 0 auto' : 'unset' }}>
            {variant === 'c'
              ? <window.Dot color={t.ok} size={7} />
              : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: `12px ${window.UIFONT}`, color: t.textMid }}><window.Dot color={t.ok} size={6} />Saved</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {['min', 'max', 'close'].map((k) => (
              <div key={k} style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.textMuted }}>
                <span style={{ width: 9, height: k === 'min' ? 1 : 9, border: k === 'min' ? 'none' : `1px solid ${t.textMuted}`, borderBottom: k === 'min' ? `1px solid ${t.textMuted}` : undefined, borderRadius: 1 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* boundary-cue variants */
function CueVariant({ variant }) {
  const t = window.vesselLight;
  const inner = {
    a: { padding: 7, child: { borderRadius: 6, background: t.toolBg, border: `1px solid ${t.wellBorder}`, boxShadow: t.wellShadow } },
    b: { padding: 0, child: { background: t.toolBg, borderTop: `1px solid ${t.wellBorder}` } },
    c: { padding: 0, child: { background: t.toolBg } },
  }[variant];
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: t.appBg, border: `1px solid ${t.winBorder}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ height: 30, background: t.bar, borderBottom: `1px solid ${t.barBorder}`, display: 'flex', alignItems: 'center', gap: 7, padding: '0 11px' }}>
        <window.VesselGlyph t={t} size={13} />
        <span style={{ font: `12px ${window.UIFONT}`, fontWeight: 540, color: t.text }}>Tool</span>
      </div>
      <div style={{ flex: 1, background: t.bar, padding: inner.padding, minHeight: 0 }}>
        <div style={{ height: '100%', ...inner.child, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ font: `11px ${window.MONO}`, color: t.textMuted }}>tool surface</span>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
