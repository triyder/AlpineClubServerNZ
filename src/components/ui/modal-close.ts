/**
 * What the `<dialog>`'s `close` event means for the Modal, as a pure decision
 * so it can be unit-tested without a browser.
 *
 * `cancel` (Escape) can be prevented, but Chromium closes the dialog anyway on
 * a SECOND Escape inside the same user activation — the close-watcher rule —
 * and fires `close` without ever asking again. So while the dialog is not
 * dismissible (a save is in flight) and the caller still wants it open, the
 * right response to `close` is to show it again; only when the caller itself
 * closed it (set `open` to false) does `close` mean "tell the caller".
 */
export type DialogCloseAction = "reopen" | "notify";

export function decideDialogClose(input: {
  /** The `dismissible` prop at the moment of the event. */
  dismissible: boolean;
  /** The `open` prop at the moment of the event — what the caller wants. */
  wantedOpen: boolean;
}): DialogCloseAction {
  return !input.dismissible && input.wantedOpen ? "reopen" : "notify";
}
