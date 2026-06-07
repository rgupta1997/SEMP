/* global React, ReactDOM, Icon, cx, Avatar, Button, EmptyState, PageHeader, Card, CompactScoreCard,
   Sidebar, TopBar, BottomTabs, CommandPalette, ROLES, NAV, navItemByKey, SportChip,
   SPORTS, TENANTS, seedMatches, scoreReducer,
   Scoreboard, BigScreen, MatchConsole,
   LiveOps, OfficialMatches, SpectatorLive, Standings, Medals, Schedule, ParticipantDash, DesignSystem, Placeholder */
const { useReducer, useState: aST, useEffect: aEF, useCallback } = React;
const a = React.createElement;

/* ---- tenant brand engine: oklch ramp from hue + chroma ---- */
function applyBrand(hue, chroma, dark) {
  const Ls = dark
    ? [0.30, 0.35, 0.42, 0.52, 0.62, 0.69, 0.62, 0.56, 0.48, 0.40]
    : [0.972, 0.94, 0.885, 0.805, 0.705, 0.60, 0.53, 0.468, 0.405, 0.34];
  const Cmul = [0.10, 0.22, 0.40, 0.62, 0.82, 1.0, 1.02, 0.95, 0.78, 0.58];
  const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
  const root = document.documentElement;
  steps.forEach((s, i) => root.style.setProperty(`--brand-${s}`, `oklch(${Ls[i]} ${(Cmul[i] * chroma).toFixed(3)} ${hue})`));
  root.style.setProperty("--brand-contrast", dark ? "#06080d" : "#ffffff");
}

/* ---- store ---- */
function storeReducer(state, action) {
  switch (action.type) {
    case "DISPATCH": {
      const { id, action: act } = action;
      const m = state.matches.find((x) => x.id === id);
      if (!m) return state;
      const nm = scoreReducer(m, act);
      const matches = state.matches.map((x) => (x.id === id ? nm : x));
      const hist = { ...state.hist };
      if (!["TICK", "TOGGLE_CLOCK"].includes(act.type)) hist[id] = [...(hist[id] || []), m].slice(-40);
      return { matches, hist };
    }
    case "UNDO": {
      const h = state.hist[action.id] || [];
      if (!h.length) return state;
      return { matches: state.matches.map((x) => (x.id === action.id ? h[h.length - 1] : x)), hist: { ...state.hist, [action.id]: h.slice(0, -1) } };
    }
    case "TICK_ALL":
      return { ...state, matches: state.matches.map((m) => (m.status === "live" ? scoreReducer(m, { type: "TICK" }) : m)) };
    default: return state;
  }
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "density": "regular",
  "tenant": "sportagon",
  "brandHue": "tenant",
  "offline": false,
  "liveData": true
}/*EDITMODE-END*/;

// Curated brand hues (any organiser color → accessible ramp algorithm)
const BRAND_HUES = { tenant: null, azure: 256, emerald: 158, sunset: 28, violet: 295, magenta: 330 };
const DENSITY_MAP = { compact: 0.88, regular: 1, comfortable: 1.12 };

function App() {
  const [t, setTweak] = window.useTweaks(TWEAK_DEFAULTS);
  const theme = t.theme;
  const density = DENSITY_MAP[t.density] || 1;
  const tenantKey = t.tenant;
  const offline = t.offline;
  const customHue = BRAND_HUES[t.brandHue] != null ? BRAND_HUES[t.brandHue] : null;
  const setTheme = (v) => setTweak("theme", v);

  const [role, setRole] = aST("organiser");
  const [active, setActive] = aST("liveops");

  const [store, dispatch] = useReducer(storeReducer, null, () => ({ matches: seedMatches(), hist: {} }));
  const [consoleId, setConsoleId] = aST(null);
  const [scoreboardId, setScoreboardId] = aST(null);
  const [bigScreen, setBigScreen] = aST(false);
  const [sideOpen, setSideOpen] = aST(false);
  const [collapsed, setCollapsed] = aST(false);
  const [cmdk, setCmdk] = aST(false);

  const tenant = TENANTS[tenantKey];

  // apply theme + brand
  aEF(() => { document.documentElement.classList.toggle("dark", theme === "dark"); }, [theme]);
  aEF(() => {
    const hue = customHue != null ? customHue : tenant.hue;
    const chroma = customHue != null ? 0.16 : tenant.chroma;
    applyBrand(hue, chroma, theme === "dark");
  }, [tenantKey, theme, customHue]);
  aEF(() => { document.documentElement.style.setProperty("--density", density); }, [density]);

  // live clock (pausable via tweak)
  aEF(() => {
    if (!t.liveData) return;
    const iv = setInterval(() => dispatch({ type: "TICK_ALL" }), 1000); return () => clearInterval(iv);
  }, [t.liveData]);

  // ⌘K
  aEF(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdk((v) => !v); }
      if (e.key === "Escape") { setCmdk(false); }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);

  const goConsole = useCallback((id) => { setConsoleId(id); setRole("official"); }, []);
  const goScoreboard = useCallback((id) => setScoreboardId(id), []);
  const onNav = (key) => {
    setSideOpen(false);
    if (key === "scoreboard") { setActive("scoreboard"); return; }
    setActive(key); setConsoleId(null);
  };
  const switchRole = (rk) => { setRole(rk); setConsoleId(null); setActive(ROLES[rk].home); setSideOpen(false); };
  const onPick = ([rk, key]) => { setCmdk(false); setRole(rk); setActive(key); setConsoleId(null); };

  const m = (id) => store.matches.find((x) => x.id === id);

  function renderScreen() {
    if (consoleId) {
      const match = m(consoleId);
      return a(MatchConsole, {
        m: match, syncOffline: offline,
        dispatch: (act) => dispatch({ type: "DISPATCH", id: consoleId, action: act }),
        onUndo: () => dispatch({ type: "UNDO", id: consoleId }),
        canUndo: (store.hist[consoleId] || []).length > 0,
        onExit: () => setConsoleId(null),
      });
    }
    switch (active) {
      case "liveops": return a(LiveOps, { matches: store.matches, openScoreboard: goScoreboard, openBigScreen: () => setBigScreen(true) });
      case "mymatches": return a(OfficialMatches, { matches: store.matches, openConsole: goConsole });
      case "dashboard": return a(ParticipantDash, { matches: store.matches, openScoreboard: goScoreboard });
      case "spectator": return a(SpectatorLive, { matches: store.matches, openScoreboard: goScoreboard, openBigScreen: () => setBigScreen(true) });
      case "standings": return a(Standings, null);
      case "medals": return a(Medals, null);
      case "schedule": return a(Schedule, { matches: store.matches, openScoreboard: goScoreboard });
      case "design": return a(DesignSystem, { theme });
      case "scoreboard": return a(ScoreboardLanding, { matches: store.matches, openBigScreen: () => setBigScreen(true), openScoreboard: goScoreboard });
      case "mymatches_p": return a(SimpleMatchList, { matches: store.matches, openScoreboard: goScoreboard });
      default: return a(Placeholder, { navItem: navItemByKey(role, active), onGo: () => switchRole("organiser") });
    }
  }

  return a("div", { className: cx("app", collapsed && "collapsed") },
    sideOpen && a("div", { className: "drawer-scrim desktop-hide", onClick: () => setSideOpen(false) }),
    a(SidebarHost, { role, active, onNav, collapsed, tenant, sideOpen, onToggleCollapse: () => setCollapsed((c) => !c) }),
    a("div", { className: "main" },
      a(TopBar, { role, setRole: switchRole, active, tenant, theme, setTheme, density, onMenu: () => setSideOpen(true), onSearch: () => setCmdk(true) }),
      a("div", { className: "content" }, renderScreen()),
      a(BottomTabs, { role, active, onNav })
    ),
    scoreboardId && a("div", { className: "sb-modal-scrim", onClick: () => setScoreboardId(null) },
      a("div", { className: "sb-modal", onClick: (e) => e.stopPropagation() },
        a(Scoreboard, { m: m(scoreboardId), onExit: () => setScoreboardId(null) }))),
    bigScreen && a(BigScreen, { matches: store.matches, onExit: () => setBigScreen(false) }),
    a(CommandPalette, { open: cmdk, onClose: () => setCmdk(false), onPick }),
    a(AppTweaks, { t, setTweak, role, switchRole })
  );
}

const { TweaksPanel, TweakSection, TweakRadio, TweakSelect, TweakToggle } = window;
function AppTweaks({ t, setTweak, role, switchRole }) {
  const swatch = (key, hue) => a("button", {
    key, title: key, onClick: () => setTweak("brandHue", key),
    style: {
      width: 30, height: 30, borderRadius: 9, flex: "none", cursor: "pointer",
      border: t.brandHue === key ? "2px solid var(--text-primary)" : "2px solid var(--border-default)",
      background: hue == null ? "var(--surface-sunken)" : `oklch(0.6 0.16 ${hue})`,
      display: "grid", placeItems: "center", color: "#fff", fontSize: 11, fontWeight: 800,
    },
  }, hue == null ? "T" : "");
  return a(TweaksPanel, null,
    a(TweakSection, { label: "Appearance" }),
    a(TweakRadio, { label: "Theme", value: t.theme, options: ["light", "dark"], onChange: (v) => setTweak("theme", v) }),
    a(TweakRadio, { label: "Density", value: t.density, options: ["compact", "regular", "comfortable"], onChange: (v) => setTweak("density", v) }),
    a(TweakSection, { label: "White-label · tenant" }),
    a(TweakSelect, { label: "Organiser", value: t.tenant, options: Object.keys(TENANTS).map((k) => ({ value: k, label: TENANTS[k].short })), onChange: (v) => setTweak("tenant", v) }),
    a("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 2px" } },
      a("span", { style: { fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)" } }, "Brand hue"),
      a("div", { style: { display: "flex", gap: 6 } }, Object.entries(BRAND_HUES).map(([k, hue]) => swatch(k, hue)))),
    a(TweakSection, { label: "Demo controls" }),
    a(TweakSelect, { label: "Persona", value: role, options: Object.keys(ROLES).map((k) => ({ value: k, label: ROLES[k].label })), onChange: switchRole }),
    a(TweakToggle, { label: "Official: offline mode", value: t.offline, onChange: (v) => setTweak("offline", v) }),
    a(TweakToggle, { label: "Live data (auto-tick clock)", value: t.liveData, onChange: (v) => setTweak("liveData", v) })
  );
}

// Sidebar host adds the collapse toggle + mobile open class
function SidebarHost({ role, active, onNav, collapsed, tenant, sideOpen, onToggleCollapse }) {
  return a("div", { className: cx("sidebar", collapsed && "collapsed", sideOpen && "open"), style: { display: "flex" } },
    a("div", { className: "sidebar-head", style: { justifyContent: "space-between" } },
      collapsed ? a(window.Logomark, { size: 30 }) : a(window.Wordmark, { tenant }),
      a("button", { className: "iconbtn hide-mobile", style: { width: 32, height: 32 }, onClick: onToggleCollapse, "aria-label": "Collapse" },
        a(Icon, { name: collapsed ? "chevronRight" : "chevronLeft", size: 18 }))
    ),
    a("nav", { className: "sidebar-nav no-scrollbar" },
      NAV[role].map((grp, gi) => a("div", { key: gi, className: "nav-group" },
        grp.group && !collapsed && a("div", { className: "nav-group-label" }, grp.group),
        grp.items.map((it) => a("button", {
          key: it.key, className: cx("nav-item", active === it.key && "active"),
          onClick: () => onNav(it.key), title: collapsed ? it.label : null,
        },
          a(Icon, { name: it.icon, size: 19 }),
          !collapsed && a("span", { className: "nav-label" }, it.label),
          !collapsed && it.badge && a("span", { className: "nav-badge tnum" }, it.badge)))
      ))
    ),
    a("div", { className: "sidebar-foot" },
      !collapsed && a("div", { className: "demo-hint" }, a(Icon, { name: "command", size: 13 }), a("span", null, "Press ", a("span", { className: "kbd" }, "⌘K"), " to search"))
    )
  );
}

function ScoreboardLanding({ matches, openBigScreen, openScoreboard }) {
  const live = matches.filter((x) => x.status === "live");
  return a("div", { className: "content-pad content-max fade-up" },
    a(PageHeader, { eyebrow: "Venue Display", title: "Big-Screen Scoreboard",
      sub: "Full-screen, dark, auto-rotating across all live matches. Built for stadium displays.",
      actions: a(Button, { variant: "primary", icon: "tv", onClick: openBigScreen }, "Enter big screen") }),
    live[0] && a("div", { style: { marginTop: 8 } }, a(Scoreboard, { m: live[0] })),
    a("div", { className: "card-grid-3", style: { marginTop: 16 } },
      live.slice(1).map((mm) => a(CompactScoreCard, { key: mm.id, m: mm, accentTop: true, onOpen: () => openScoreboard(mm.id), cta: "Preview" })))
  );
}

function SimpleMatchList({ matches, openScoreboard }) {
  return a("div", { className: "content-pad content-max fade-up" },
    a(PageHeader, { eyebrow: "Athlete", title: "My Matches", sub: "Every fixture you're part of, across events." }),
    a("div", { className: "card-grid-3" },
      matches.map((mm) => a(CompactScoreCard, { key: mm.id, m: mm, accentTop: true, onOpen: () => openScoreboard(mm.id), cta: mm.status === "live" ? "Watch" : "View" })))
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(a(App));
