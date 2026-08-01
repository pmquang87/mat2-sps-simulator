/**
 * A hand-rolled `document` just large enough to construct a ui/ panel in the node test
 * environment (ARCHITECTURE.md §9).
 *
 * jsdom is deliberately not a dependency of this repo (see tests/ui/layout.test.ts), but the
 * start-track chooser's binding rule — "render the seat the HOST reports, never your own
 * click" — is a property of the real `ControlPanel`, not of a model beside it. A model-only
 * test would be a check that cannot fail on the shipped panel, so the panel is built for
 * real against this stub instead.
 *
 * The stub covers exactly what `src/ui/dom.ts` and the panels touch: element creation,
 * className/classList, textContent/title, attributes, dataset, child lists, listeners, the
 * `disabled`/`hidden`/`checked` flags, and `<select>`/`<option>` value semantics (a select's
 * `value` is its selected option's value; assigning one selects the matching option). It is
 * NOT a DOM implementation — anything beyond that belongs in the running app.
 */

export interface FakeEvent {
  type: string;
  /** `KeyboardEvent.key` — the momentary plant buttons read it (' ' / 'Enter'). */
  key?: string;
  /** Filled in by `dispatchEvent` so a handler may always call it. */
  preventDefault?: () => void;
}

export class FakeElement {
  readonly tagName: string;
  className = '';
  title = '';
  /** `<html lang>` — i18n's `setLocale` stamps the active locale onto it. */
  lang = '';
  textContent = '';
  disabled = false;
  hidden = false;
  checked = false;
  selected = false;
  readonly dataset: Record<string, string> = {};
  readonly childNodes: FakeElement[] = [];
  parentNode: FakeElement | null = null;

  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, ((ev: FakeEvent) => void)[]>();
  private ownValue = '';

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
  }

  get firstChild(): FakeElement | null {
    return this.childNodes[0] ?? null;
  }

  get children(): readonly FakeElement[] {
    return this.childNodes;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentNode?.removeChild(child);
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }

  removeChild(child: FakeElement): FakeElement {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  remove(): void {
    this.parentNode?.removeChild(this);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type: string, handler: (ev: FakeEvent) => void): void {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(handler);
    this.listeners.set(type, bucket);
  }

  /**
   * Fire a listener bundle synchronously. No bubbling — the panels bind on the target.
   *
   * `preventDefault` is supplied unless the caller brought its own: real handlers call it
   * (the momentary buttons suppress the browser's synthesized click), and a stub event
   * without it would fail for a reason that has nothing to do with the behaviour under test.
   */
  dispatchEvent(ev: FakeEvent): void {
    const event: FakeEvent = { preventDefault: () => undefined, ...ev };
    for (const handler of this.listeners.get(ev.type) ?? []) handler(event);
  }

  get classList(): {
    add(name: string): void;
    remove(name: string): void;
    contains(name: string): boolean;
    toggle(name: string, force?: boolean): void;
  } {
    const classes = (): string[] => this.className.split(/\s+/).filter((c) => c !== '');
    const write = (list: string[]): void => {
      this.className = list.join(' ');
    };
    return {
      add: (name) => {
        const list = classes();
        if (!list.includes(name)) write([...list, name]);
      },
      remove: (name) => write(classes().filter((c) => c !== name)),
      contains: (name) => classes().includes(name),
      toggle: (name, force) => {
        const on = force ?? !classes().includes(name);
        if (on) {
          const list = classes();
          if (!list.includes(name)) write([...list, name]);
        } else {
          write(classes().filter((c) => c !== name));
        }
      },
    };
  }

  /** `<select>`: index of the selected option, −1 for none; assigning −1 deselects all —
   *  the HTML behaviour `setSeatedTrack(null)` relies on for the visibly-unnamed seat. */
  get selectedIndex(): number {
    return this.childNodes.findIndex((option) => option.selected);
  }

  set selectedIndex(index: number) {
    this.childNodes.forEach((option, i) => {
      option.selected = i === index;
    });
  }

  /** `<select>`: the selected option's value. `<option>`: its `value` attribute, else its
   *  text — exactly the HTML rules the panels rely on. */
  get value(): string {
    if (this.tagName === 'select') {
      return this.childNodes.find((option) => option.selected)?.value ?? '';
    }
    if (this.tagName === 'option') {
      return this.getAttribute('value') ?? this.textContent;
    }
    return this.ownValue;
  }

  set value(next: string) {
    if (this.tagName === 'select') {
      for (const option of this.childNodes) option.selected = option.value === next;
      return;
    }
    this.ownValue = next;
  }
}

export interface FakeDocument {
  readonly documentElement: FakeElement;
  createElement(tag: string): FakeElement;
  createTextNode(text: string): FakeElement;
}

export function createFakeDocument(): FakeDocument {
  return {
    documentElement: new FakeElement('html'),
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => {
      const node = new FakeElement('#text');
      node.textContent = text;
      return node;
    },
  };
}

/**
 * Install the stub as the global `document` and return the undo. Vitest isolates test files,
 * so the global never reaches a suite that did not ask for it.
 */
export function installFakeDocument(): () => void {
  const globals = globalThis as unknown as { document?: unknown };
  const previous = globals.document;
  globals.document = createFakeDocument();
  return () => {
    if (previous === undefined) delete globals.document;
    else globals.document = previous;
  };
}

/** Depth-first walk of an element tree — for locating a control in a built panel. */
export function walk(root: FakeElement): FakeElement[] {
  const out: FakeElement[] = [root];
  for (const child of root.childNodes) out.push(...walk(child));
  return out;
}

/** Every `<select>` of a built panel, document order. */
export function selects(root: FakeElement): FakeElement[] {
  return walk(root).filter((node) => node.tagName === 'select');
}

/** The option values a `<select>` currently offers. */
export function optionValues(select: FakeElement): string[] {
  return select.childNodes.map((option) => option.value);
}

/** What a user does: pick an option, then let the element fire its change event. */
export function choose(select: FakeElement, value: string): void {
  select.value = value;
  select.dispatchEvent({ type: 'change' });
}
