/* global React, Icon, cx, Avatar, ROLES, NAV, BOTTOM, navItemByKey, SportChip */
// Sportagon — top bar, bottom tabs, role switcher, command palette.
const { createElement: el, useState: useS, useEffect: useE } = React;

function RoleSwitch({ role, setRole }) {
  return el("div", { className: "roleswitch", role: "tablist", "aria-label": "Switch role" },
    Object.entries(ROLES).map(([key, r]) => el("button", {
      key, className: cx(role === key && "active"), title: r.label, "aria-pressed": role === key,
      onClick: () => setRole(key),
    }, el(Icon, { name: r.icon, size: 17 })))
  );
}

function TopBar({ role, setRole, active, tenant, theme, setTheme, onMenu, onSearch, density }) {
  const item = navItemByKey(role, active);
  return el("header", { className: "topbar" },
    el("button", { className: "iconbtn desktop-hide", onClick: onMenu, "aria-label": "Menu" }, el(Icon, { name: "menu" })),
    el("div", { className: "topbar-context" },
      el("span", { className: "ctx-title hide-mobile" }, tenant.name),
      el("span", { className: "text-muted hide-mobile", style: { opacity: .5 } }, "/"),
      el("span", { className: "ctx-title", style: { color: "var(--text-secondary)" } }, item ? item.label : ROLES[role].label)
    ),
    el("div", { className: "topbar-spacer" }),
    el("button", { className: "searchbar hide-mobile", onClick: onSearch },
      el(Icon, { name: "search", size: 16 }),
      el("span", { style: { flex: 1, textAlign: "left" } }, "Search events, teams, athletes…"),
      el("span", { className: "kbd" }, "⌘K")
    ),
    el("button", { className: "iconbtn desktop-hide", onClick: onSearch, "aria-label": "Search" }, el(Icon, { name: "search" })),
    el(RoleSwitch, { role, setRole }),
    el("button", { className: "iconbtn", onClick: () => setTheme(theme === "dark" ? "light" : "dark"), "aria-label": "Toggle theme" },
      el(Icon, { name: theme === "dark" ? "sun" : "moon", size: 19 })),
    el("button", { className: "iconbtn", "aria-label": "Notifications" }, el(Icon, { name: "bell", size: 19 }), el("span", { className: "notif-dot" })),
    el("button", { className: "usermenu", "aria-label": "Account" },
      el(Avatar, { name: "Riya Mehta", size: "md" }),
      el(Icon, { name: "chevronDown", size: 15, className: "hide-mobile text-muted" })
    )
  );
}

function BottomTabs({ role, active, onNav }) {
  return el("nav", { className: "bottombar", "aria-label": "Primary" },
    BOTTOM[role].map((key) => {
      const it = navItemByKey(role, key); if (!it) return null;
      return el("button", { key, className: cx(active === key && "active"), onClick: () => onNav(key) },
        it.badge && el("span", { className: "bt-dot" }),
        el(Icon, { name: it.icon, size: 21 }), el("span", null, it.label));
    })
  );
}

// Command palette (⌘K)
const CMDS = [
  { icon: "broadcast", label: "Live Ops board", hint: "Organiser", go: ["organiser", "liveops"] },
  { icon: "whistle", label: "Score a match — Match Console", hint: "Official", go: ["official", "mymatches"] },
  { icon: "tv", label: "Open Big-Screen Scoreboard", hint: "Spectator", go: ["spectator", "scoreboard"] },
  { icon: "list", label: "Championship standings", hint: "Results", go: ["spectator", "standings"] },
  { icon: "medal", label: "Medal tally", hint: "Results", go: ["spectator", "medals"] },
  { icon: "user", label: "Athlete dashboard", hint: "Participant", go: ["participant", "dashboard"] },
  { icon: "layers", label: "Design System & foundations", hint: "Admin", go: ["admin", "design"] },
  { icon: "calendar", label: "Schedule & agenda", hint: "Organiser", go: ["organiser", "schedule"] },
];
function CommandPalette({ open, onClose, onPick }) {
  const [q, setQ] = useS("");
  useE(() => { if (open) setQ(""); }, [open]);
  if (!open) return null;
  const res = CMDS.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()) || c.hint.toLowerCase().includes(q.toLowerCase()));
  return el("div", { className: "cmdk-scrim", onClick: onClose },
    el("div", { className: "cmdk", onClick: (ev) => ev.stopPropagation() },
      el("div", { className: "cmdk-input" },
        el(Icon, { name: "search", size: 18, className: "text-muted" }),
        el("input", { autoFocus: true, placeholder: "Search or jump to…", value: q, onChange: (e2) => setQ(e2.target.value),
          onKeyDown: (e2) => { if (e2.key === "Enter" && res[0]) { onPick(res[0].go); } if (e2.key === "Escape") onClose(); },
          style: { flex: 1, background: "none", border: "none", outline: "none", fontSize: 16, color: "var(--text-primary)" } }),
        el("span", { className: "kbd" }, "ESC")
      ),
      el("div", { className: "cmdk-list no-scrollbar" },
        res.length === 0 && el("div", { className: "sm text-muted", style: { padding: 20, textAlign: "center" } }, "No matches"),
        res.map((c, i) => el("button", { key: i, className: "cmdk-item", onClick: () => onPick(c.go) },
          el("span", { className: "cmdk-ic" }, el(Icon, { name: c.icon, size: 17 })),
          el("span", { style: { flex: 1, textAlign: "left", fontWeight: 600, fontSize: 14 } }, c.label),
          el("span", { className: "xs text-muted" }, c.hint),
          el(Icon, { name: "arrowRight", size: 15, className: "text-muted" })
        ))
      )
    )
  );
}

Object.assign(window, { TopBar, BottomTabs, RoleSwitch, CommandPalette });
