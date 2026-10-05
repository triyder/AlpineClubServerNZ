import { describe, it, expect } from "vitest";
import { decideDialogClose } from "@/components/ui/modal-close";

/**
 * The Modal's `close` decision. What this does NOT cover, because it needs a
 * browser: that Chromium really fires `close` on a second Escape, that
 * `showModal()` from inside the handler re-shows the dialog without a loop,
 * `aria-describedby` wiring and the scroll lock. Those are checked by hand.
 */
describe("decideDialogClose", () => {
  it("re-shows the dialog when it is not dismissible and the caller still wants it open", () => {
    expect(decideDialogClose({ dismissible: false, wantedOpen: true })).toBe("reopen");
  });

  it("tells the caller when the dialog is dismissible", () => {
    expect(decideDialogClose({ dismissible: true, wantedOpen: true })).toBe("notify");
  });

  it("tells the caller when the caller itself closed it, even mid-save", () => {
    // A successful save closes the form while `saving` may still be true;
    // re-showing it then would trap the person in a finished dialog.
    expect(decideDialogClose({ dismissible: false, wantedOpen: false })).toBe("notify");
    expect(decideDialogClose({ dismissible: true, wantedOpen: false })).toBe("notify");
  });
});
