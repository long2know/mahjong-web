import { button, el, icon, text } from "./dom";

export class Modal {
  readonly root = el("dialog", "modal");
  readonly body = el("div", "modal-content");
  readonly notice = el("p", "note");
  private readonly title = el("h2");
  private opener: HTMLElement | null = null;
  kind: "settings" | "rules" | "create" | "chat" | "results" | "invite" | null = null;

  constructor(closed: () => void) {
    const close = button("", "btn icon-btn", () => this.close());
    close.setAttribute("aria-label", "Close dialog");
    close.append(icon("close"));
    this.title.id = "dialog-title";
    this.title.tabIndex = -1;
    this.root.setAttribute("aria-labelledby", this.title.id);
    this.root.append(el("header", "modal-head", this.title, close), this.body);
    this.notice.setAttribute("role", "status");
    this.notice.hidden = true;
    this.root.addEventListener("close", () => {
      if (this.root.open) return;
      this.kind = null;
      if (this.opener?.isConnected && !this.opener.hasAttribute("disabled")) this.opener.focus({ preventScroll: true });
      this.opener = null;
      closed();
    });
    if (window.visualViewport) {
      const viewport = window.visualViewport;
      const measure = () => this.root.style.setProperty("--visual-viewport", `${viewport.height}px`);
      viewport.addEventListener("resize", measure, { passive: true });
      measure();
    }
  }

  show(kind: NonNullable<Modal["kind"]>, title: string, content: HTMLElement, opener?: HTMLElement): void {
    this.kind = kind;
    if (!this.root.open) this.opener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    text(this.title, title);
    this.notice.hidden = true;
    text(this.notice, "");
    this.body.replaceChildren(content, this.notice);
    if (!this.root.open) this.root.showModal();
    this.title.focus({ preventScroll: true });
  }

  close(): void {
    if (this.root.open) this.root.close();
  }

  message(message: string): void {
    this.notice.hidden = !message;
    text(this.notice, message);
  }
}
