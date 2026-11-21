export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className = "", ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

export function text(node: Node, value: string | number): void {
  const string = String(value);
  if (node.textContent !== string) node.textContent = string;
}

export function button(label: string, className: string, activate?: () => void): HTMLButtonElement {
  const node = el("button", className, label);
  node.type = "button";
  if (activate) node.addEventListener("click", activate);
  return node;
}

export function reconcile<T, N extends HTMLElement>(
  parent: HTMLElement, items: readonly T[], key: (item: T, index: number) => string,
  create: (item: T, index: number) => N, update?: (node: N, item: T, index: number, fresh: boolean) => void,
): void {
  const old = new Map(Array.from(parent.children, child => [
    (child as N).dataset.key, child as N,
  ]));
  let at: Element | null = parent.firstElementChild;
  items.forEach((item, index) => {
    const id = key(item, index);
    const previous = old.get(id);
    const node = previous ?? create(item, index);
    node.dataset.key = id;
    old.delete(id);
    if (node !== at) parent.insertBefore(node, at);
    at = node.nextElementSibling;
    update?.(node, item, index, !previous);
  });
  old.forEach(node => node.remove());
}

export const winds = ["East", "South", "West", "North"] as const;
export const places = ["near", "right", "far", "left"] as const;

export function wind(seat: number, dealer: number): typeof winds[number] {
  return winds[(seat - dealer + 4) % 4];
}

const svgNs = "http://www.w3.org/2000/svg";
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(svgNs, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

const iconPaths = {
  lantern: "M8 5h8M8 18h8m-4 0v3M12 6C6.5 6 4 8.6 4 12s2.5 5 8 5 8-1.6 8-5-2.5-6-8-6Zm0 0c-2.3 0-3.6 2.5-3.6 5.7S9.7 17 12 17m0-11c2.3 0 3.6 2.5 3.6 5.7S14.3 17 12 17",
  settings: "M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-6 2v4",
  chat: "M20 5H4v12h4v4l4-4h8V5ZM8 10h8m-8 3h5",
  book: "M12 6C9 4 6 4 3 5v13c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v13",
  arrow: "M4 12h15m-6-6 6 6-6 6",
  copy: "M8 8h12v12H8zM4 16V4h12",
  close: "m6 6 12 12M18 6 6 18",
  refresh: "M20 10a8 8 0 1 0-1.5 6.7M20 4v6h-6",
  lock: "M6 10h12v10H6zm2 0V7a4 4 0 0 1 8 0v3m-4 4v2",
  globe: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18m-9-9c-5 5-5 13 0 18 5-5 5-13 0-18Z",
  pause: "M9 5v14m6-14v14",
} as const;

export function icon(name: keyof typeof iconPaths): SVGSVGElement {
  const node = svg("svg", { viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", class: "icon" });
  node.append(svg("path", {
    d: iconPaths[name], stroke: "currentColor", "stroke-width": 1.65, "stroke-linecap": "round", "stroke-linejoin": "round",
  }));
  return node;
}
