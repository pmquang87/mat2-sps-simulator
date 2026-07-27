/**
 * Minimal DOM element factory shared by the ui/ panels.
 *
 * Deviation note (ARCHITECTURE.md §3 file list): this helper is not in the planned file
 * list. It introduces no new module boundary and no new public contract — it exists so the
 * panels stay declarative instead of repeating createElement/appendChild boilerplate.
 *
 * There is deliberately no innerHTML path: every string reaches the DOM as a text node, so
 * no localized text, symbol name or diagnostic message can ever be interpreted as markup.
 */

export type Child = Node | string | number | null | undefined | false;

export interface ElOptions {
  className?: string;
  text?: string | number;
  title?: string;
  /** Verbatim attributes (type, role, aria-*, min/max, …). */
  attrs?: Record<string, string>;
  dataset?: Record<string, string>;
  children?: Child[];
  onClick?: (ev: MouseEvent) => void;
  onInput?: (ev: Event) => void;
  onChange?: (ev: Event) => void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className !== undefined) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  if (options.title !== undefined) node.title = options.title;
  if (options.attrs !== undefined) {
    for (const [name, value] of Object.entries(options.attrs)) node.setAttribute(name, value);
  }
  if (options.dataset !== undefined) {
    for (const [name, value] of Object.entries(options.dataset)) node.dataset[name] = value;
  }
  if (options.children !== undefined) append(node, ...options.children);
  // The cast is needed because `node` is generic here: TS then falls back to the
  // string-keyed addEventListener overload, which types the event as `Event`.
  if (options.onClick !== undefined) node.addEventListener('click', options.onClick as EventListener);
  if (options.onInput !== undefined) node.addEventListener('input', options.onInput);
  if (options.onChange !== undefined) node.addEventListener('change', options.onChange);
  return node;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function clear(node: Node): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

/** A labelled <select>; returns both the wrapper and the select for later relabelling. */
export function selectField(
  labelText: string,
  values: readonly { value: string; label: string }[],
  current: string,
  onChange: (value: string) => void,
): { wrapper: HTMLLabelElement; label: HTMLSpanElement; select: HTMLSelectElement } {
  const label = el('span', { className: 'field-label', text: labelText });
  const select = el('select', { className: 'field-input' });
  for (const item of values) {
    const option = el('option', { text: item.label, attrs: { value: item.value } });
    if (item.value === current) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  const wrapper = el('label', { className: 'field', children: [label, select] });
  return { wrapper, label, select };
}
