import { button, el, text } from "./dom";

const note = el("p", "note");
note.setAttribute("role", "status");
let busy = false;

function message(value: string): void {
  text(note, value);
  note.hidden = !value;
}

function refresh(): void {
  const active = !!document.fullscreenElement;
  const supported = typeof document.exitFullscreen === "function" && (active ||
    (document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === "function"));
  text(control, active ? "Exit full screen" : "Enter full screen");
  control.disabled = !supported;
  control.setAttribute("aria-disabled", String(busy || !supported));
  if (!supported) message("Full screen is unavailable here. Use your browser’s controls if available.");
}

const control = button("", "btn subtle", async () => {
  if (busy || control.disabled) return;
  busy = true;
  refresh();
  message("");
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    message("Couldn’t change full screen. Try again or use your browser’s controls.");
  } finally {
    busy = false;
    refresh();
  }
});

const row = el("div", "row-actions", control, note);
document.addEventListener("fullscreenchange", () => {
  refresh();
  const dialog = row.closest("dialog");
  if (document.fullscreenElement !== document.documentElement || !dialog?.open) return;
  // Fullscreen may put the document above an already-open dialog in the top layer.
  const focus = document.activeElement;
  dialog.close();
  dialog.showModal();
  if (focus instanceof HTMLElement && dialog.contains(focus)) focus.focus({ preventScroll: true });
});

export function addFullscreen(actions: HTMLElement): void {
  if (!actions.isConnected) return;
  message("");
  refresh();
  actions.before(row);
}
