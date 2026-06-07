/* global React */
// Sportagon — coherent outline icon set (1.75px stroke, 24px grid)
const { createElement: h } = React;

const PATHS = {
  home: "M3 11.5 12 4l9 7.5M5 10v10h14V10",
  calendar: "M7 3v3M17 3v3M3.5 9h17M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5Z",
  trophy: "M7 4h10v4a5 5 0 0 1-10 0V4ZM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M9.5 13.5 9 18h6l-.5-4.5M8 21h8M10 18v3M14 18v3",
  whistle: "M3 12a5 5 0 0 1 5-5h9l4-2v6a7 7 0 0 1-7 7H8a5 5 0 0 1-5-5Zm5 0h.01",
  flag: "M5 21V4M5 4h10l-1.5 3L15 10H5",
  users: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM22 19v-1a4 4 0 0 0-3-3.87M16 4.13A4 4 0 0 1 16 11.5",
  user: "M20 21v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  chevronLeft: "M15 6l-6 6 6 6", chevronRight: "M9 6l6 6-6 6",
  chevronDown: "M6 9l6 6 6-6", chevronUp: "M6 15l6-6 6 6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z",
  menu: "M3 6h18M3 12h18M3 18h18",
  x: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14", minus: "M5 12h14",
  check: "M20 6 9 17l-5-5",
  checkCircle: "M9 12l2 2 4-4M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  undo: "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  play: "M6 4v16l13-8z", pause: "M8 5v14M16 5v14",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM13 13h7v7h-7zM4 13h7v7H4z",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z",
  lock: "M6 10V8a6 6 0 1 1 12 0v2M5 10h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z",
  medal: "M8 4 6 2h12l-2 2M12 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM9 4l3 6 3-6",
  tv: "M3 6h18v12H3zM8 21h8M12 18v3",
  broadcast: "M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0M12 12v9M9 21h6",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  arrowUp: "M12 19V5M5 12l7-7 7 7", arrowDown: "M12 5v14M5 12l7 7 7-7",
  arrowRight: "M5 12h14M12 5l7 7-7 7",
  alert: "M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  shield: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z",
  building: "M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M4 21h17M8 8h.01M8 12h.01M8 16h.01M11 8h.01M11 12h.01M11 16h.01",
  pin: "M12 21s-7-5.3-7-11a7 7 0 1 1 14 0c0 5.7-7 11-7 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  filter: "M3 5h18l-7 8v5l-4 2v-7L3 5Z",
  command: "M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  refresh: "M21 12a9 9 0 1 1-2.6-6.3M21 4v5h-5",
  wifi: "M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01",
  wifiOff: "M2 2l20 20M8.5 16a5 5 0 0 1 6-0.8M5 12.5a10 10 0 0 1 4-2.7M16 9.5a10 10 0 0 1 3 3M12 19.5h.01",
  signature: "M3 17c3 0 3-8 6-8s2 6 4 6 2-3 4-3 2 2 4 2M3 21h18",
  swap: "M7 4v13M4 14l3 3 3-3M17 20V7M14 10l3-3 3 3",
  star: "M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8L12 3Z",
  whistleSmall: "M3 12a5 5 0 0 1 5-5h9l4-2v6a7 7 0 0 1-7 7H8a5 5 0 0 1-5-5Z",
  layers: "M12 3 2 8.5 12 14l10-5.5L12 3ZM2 13.5 12 19l10-5.5M2 17.5 12 23l10-5.5",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  plusCircle: "M12 8v8M8 12h8M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
};

function Icon({ name, size = 20, stroke = 1.75, fill = false, style, className }) {
  const d = PATHS[name];
  if (!d) return null;
  const solid = name === "play";
  return h("svg", {
    width: size, height: size, viewBox: "0 0 24 24",
    fill: solid ? "currentColor" : "none",
    stroke: solid ? "none" : "currentColor",
    strokeWidth: stroke, strokeLinecap: "round", strokeLinejoin: "round",
    style: { flex: "none", ...style }, className, "aria-hidden": true,
  }, h("path", { d }));
}

window.Icon = Icon;
