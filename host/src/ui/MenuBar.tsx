import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTheme, UIFONT, MONO } from "../theme";
import { IconCheck, IconChevR } from "./icons";
import { TrustMark, type Trust } from "./primitives";
import type { Appearance } from "../theme";

export interface MenuItem {
  id?: string;
  label?: string;
  shortcut?: string;
  disabled?: boolean;
  sep?: boolean;
  check?: boolean;
  submenu?: MenuItem[];
  payload?: unknown;
}

export interface RecentEntry {
  id: string;
  name: string;
  signed?: boolean;
  time?: string;
}

export function buildMenus(
  hasTool: boolean,
  appearance: Appearance,
  recents: RecentEntry[],
): { id: string; label: string; items: MenuItem[] }[] {
  const recentItems: MenuItem[] = recents.length
    ? recents.map((r) => ({ id: "open-recent", label: r.name, payload: r }))
    : [{ id: "no-recents", label: "No recent tools", disabled: true }];
  return [
    {
      id: "file",
      label: "File",
      items: [
        { id: "open", label: "Open…", shortcut: "Ctrl+O" },
        { id: "recent", label: "Open Recent", submenu: recentItems },
        { sep: true },
        { id: "save", label: "Save", shortcut: "Ctrl+S", disabled: !hasTool },
        { id: "close", label: "Close Tool", shortcut: "Ctrl+W", disabled: !hasTool },
        { sep: true },
        { id: "settings", label: "Settings…", shortcut: "Ctrl+," },
      ],
    },
    {
      id: "view",
      label: "View",
      items: [
        {
          id: "appearance",
          label: "Appearance",
          submenu: [
            { id: "set-light", label: "Light", check: appearance === "light" },
            { id: "set-dark", label: "Dark", check: appearance === "dark" },
            { id: "set-system", label: "Use System Setting", check: appearance === "system" },
          ],
        },
      ],
    },
    {
      id: "help",
      label: "Help",
      items: [
        { id: "about", label: "About Vessel" },
        { id: "docs", label: "Documentation" },
      ],
    },
  ];
}

export function MenuBar({
  hasTool,
  appearance,
  recents,
  onAction,
  toolName,
  trust = "unsigned",
  publisher,
  right,
}: {
  hasTool: boolean;
  appearance: Appearance;
  recents: RecentEntry[];
  onAction: (id: string, payload?: unknown) => void;
  toolName?: string;
  trust?: Trust;
  publisher?: string;
  right?: ReactNode;
}) {
  const t = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const menus = buildMenus(hasTool, appearance, recents);
  return (
    <div
      ref={ref}
      style={{
        height: 32,
        flex: "0 0 32px",
        display: "flex",
        alignItems: "stretch",
        background: t.bar,
        borderBottom: `1px solid ${t.barBorder}`,
        padding: "0 4px",
        position: "relative",
        zIndex: 30,
        userSelect: "none",
      }}
    >
      {/* centered tool identity (absolute so it centers in the whole bar) */}
      {toolName && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 9,
            pointerEvents: "none",
            zIndex: 0,
          }}
        >
          <TrustMark trust={trust} publisher={publisher} compact />
          <span style={{ fontWeight: 540, fontSize: 13, color: t.text, font: `540 13px ${UIFONT}` }}>
            {toolName}
          </span>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "stretch", zIndex: 1 }}>
        {menus.map((m) => {
        const isOpen = open === m.id;
        return (
          <div key={m.id} style={{ position: "relative", display: "flex" }}>
            <button
              onClick={() => setOpen(isOpen ? null : m.id)}
              onMouseEnter={() => {
                if (open && open !== m.id) setOpen(m.id);
              }}
              style={{
                border: "none",
                background: isOpen ? t.chip : "transparent",
                color: t.textMid,
                font: `12.5px ${UIFONT}`,
                padding: "0 10px",
                cursor: "default",
                borderRadius: 5,
                margin: "4px 1px",
                transition: "background .1s, color .1s",
              }}
            >
              {m.label}
            </button>
            {isOpen && (
              <MenuDropdown
                items={m.items}
                onAction={(id, payload) => {
                  setOpen(null);
                  onAction(id, payload);
                }}
              />
            )}
          </div>
        );
        })}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", alignItems: "center", paddingRight: 6, zIndex: 1 }}>{right}</div>
    </div>
  );
}

function MenuDropdown({
  items,
  onAction,
  sub,
}: {
  items: MenuItem[];
  onAction: (id: string, payload?: unknown) => void;
  sub?: boolean;
}) {
  const t = useTheme();
  const [openSub, setOpenSub] = useState<number | null>(null);
  return (
    <div
      style={{
        position: "absolute",
        top: sub ? -5 : "100%",
        left: sub ? "100%" : 0,
        marginTop: sub ? 0 : 3,
        marginLeft: sub ? 2 : 0,
        minWidth: sub ? 200 : 224,
        background: t.toolBg,
        border: `1px solid ${t.hairStrong}`,
        borderRadius: 9,
        padding: 5,
        boxShadow: t.winShadow,
        zIndex: 60,
      }}
    >
      {items.map((it, i) => {
        if (it.sep) return <div key={i} style={{ height: 1, background: t.hair, margin: "5px 6px" }} />;
        const hasSub = !!it.submenu;
        return (
          <div key={i} style={{ position: "relative" }} onMouseEnter={() => setOpenSub(hasSub ? i : null)}>
            <button
              disabled={it.disabled}
              onClick={() => {
                if (!hasSub && !it.disabled && it.id) onAction(it.id, it.payload);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                width: "100%",
                textAlign: "left",
                padding: "7px 10px",
                border: "none",
                background: "transparent",
                cursor: "default",
                borderRadius: 6,
                opacity: it.disabled ? 0.45 : 1,
                color: it.disabled ? t.textMuted : t.text,
                font: `13px ${UIFONT}`,
              }}
              onMouseEnter={(e) => {
                if (!it.disabled) e.currentTarget.style.background = t.chip;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {it.check !== undefined && (
                <span style={{ width: 13, flex: "0 0 auto", color: t.accent, display: "flex" }}>
                  {it.check ? <IconCheck size={13} sw={2.4} /> : null}
                </span>
              )}
              <span style={{ flex: 1, whiteSpace: "nowrap" }}>{it.label}</span>
              {it.shortcut && <span style={{ font: `11px ${MONO}`, color: t.textMuted }}>{it.shortcut}</span>}
              {hasSub && (
                <span style={{ color: t.textMuted, marginRight: -2 }}>
                  <IconChevR size={13} />
                </span>
              )}
            </button>
            {hasSub && openSub === i && <MenuDropdown items={it.submenu!} onAction={onAction} sub />}
          </div>
        );
      })}
    </div>
  );
}
