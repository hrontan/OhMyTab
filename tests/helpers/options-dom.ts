type Listener = () => unknown;

export class OptionsElement {
  checked = false;
  disabled = false;
  value = "";
  textContent = "";
  innerHTML = "";
  id = "";
  type = "";
  children: OptionsElement[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, Listener> = {};
  classList = { add: (_name: string) => {} };
  addEventListener(name: string, listener: Listener) { this.listeners[name] = listener; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  replaceChildren(...children: OptionsElement[]) { this.children = children; this.textContent = ""; }
  appendChild(child: OptionsElement) { this.children.push(child); return child; }
  async dispatch(name: string) { await this.listeners[name]?.(); }
}

export function createOptionsDocument(keys: string[]) {
  const elements = Object.fromEntries(keys.map(key => [key, new OptionsElement()]));
  const form = new OptionsElement();
  const status = new OptionsElement();
  const html = new OptionsElement();
  const listeners: Record<string, Listener> = {};
  return {
    elements, form, status,
    document: {
      querySelector(selector: string) {
        return selector === "html" ? html : selector === "form" ? form :
          selector === "#status" ? status : elements[selector.slice(1)] ?? null;
      },
      querySelectorAll: () => [],
      createElement: (_tag: string) => new OptionsElement(),
      addEventListener(name: string, listener: Listener) { listeners[name] = listener; },
    },
    async load() { await listeners.DOMContentLoaded?.(); },
  };
}
