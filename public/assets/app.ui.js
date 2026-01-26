export function qs(selector, scope = document) {
  return scope.querySelector(selector);
}

export function qsa(selector, scope = document) {
  return Array.from(scope.querySelectorAll(selector));
}

export function setText(el, text) {
  if (!el) return;
  el.textContent = text == null ? "" : String(text);
}

export function clear(el) {
  if (!el) return;
  el.innerHTML = "";
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("data-")) node.setAttribute(key, value);
    else node[key] = value;
  });
  children.forEach((child) => {
    if (child == null) return;
    if (typeof child === "string") node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  });
  return node;
}

export function formatMinutes(value) {
  if (value == null || Number.isNaN(Number(value))) return "–";
  return `${value} min`;
}

export function formatPct(value) {
  if (value == null || Number.isNaN(value)) return "–";
  return `${Math.round(value * 100)}%`;
}

export function showMessage(container, message, tone = "muted") {
  if (!container) return;
  container.textContent = message;
  container.className = tone;
}
