"use client";

import { Button } from "@/components/ui/button";
import type { ComponentProps } from "react";

/**
 * A form submit button that asks first (#31).
 *
 * Server-action forms submit on click with no chance to confirm, so a
 * destructive one ("delete this key for good") needs this one client island:
 * it runs the browser's confirm dialog and only lets the submit through on OK.
 * Everything else about the form stays a plain server action.
 */
export function ConfirmSubmitButton({
  message,
  children,
  ...props
}: { message: string } & Omit<ComponentProps<typeof Button>, "type" | "onClick">) {
  return (
    <Button
      {...props}
      type="submit"
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}
