"use client";

import { useEffect } from "react";

/**
 * Once an arrival date is chosen, go straight on to the leave date (#25,
 * owner, 18 Oct 2026): the leave box may not be before the day after arrival,
 * a leave date that no longer follows the arrival is cleared, and the leave
 * box is focused with its date picker opened.
 *
 * Behaviour only (it renders nothing), so the forms keep their own markup and
 * work without JavaScript. `showPicker` needs the user's own action, which a
 * date chosen in the arrival picker is; a browser that refuses it still
 * leaves the leave box focused.
 */
export function LeaveFollowsArrive({ arriveId, leaveId }: { arriveId: string; leaveId: string }) {
  useEffect(() => {
    const arrive = document.getElementById(arriveId);
    const leave = document.getElementById(leaveId);
    if (!(arrive instanceof HTMLInputElement) || !(leave instanceof HTMLInputElement)) return;

    function onArrive() {
      if (!(arrive instanceof HTMLInputElement) || !(leave instanceof HTMLInputElement)) return;
      const day = arrive.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
      const next = new Date(`${day}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      const dayAfter = next.toISOString().slice(0, 10);
      leave.min = dayAfter;
      if (leave.value && leave.value < dayAfter) leave.value = "";
      leave.focus();
      try {
        leave.showPicker?.();
      } catch {
        // Not allowed here (no user action, or an older browser): focus is enough.
      }
    }

    arrive.addEventListener("change", onArrive);
    return () => arrive.removeEventListener("change", onArrive);
  }, [arriveId, leaveId]);

  return null;
}
