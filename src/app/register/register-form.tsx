"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerAction, type RegisterState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TokenReveal } from "@/components/token-reveal";
import { RegisterLodgePicker } from "@/components/register-lodge-picker";
import type { ClubLodgeOption } from "@/components/club-lodges-select";

const initialState: RegisterState = {};

/**
 * The registration form (#30, #40). A client island: the page around it is a
 * server component that loads the lodge options. On success it shows the
 * club's first API key once.
 */
export function RegisterForm({ lodgeOptions }: { lodgeOptions: ClubLodgeOption[] }) {
  const [state, formAction, pending] = useActionState(registerAction, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Register a lodge</CardTitle>
        <CardDescription>
          Submit your lodge details to request a connection to the central
          server. You will be given your API key straight away to paste into
          your AlpineClubBookingsNZ site; it starts working once an
          administrator approves the connection.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state.success ? (
          <div className="space-y-4 text-center">
            {state.apiKey ? (
              <>
                <p className="text-sm">
                  Thanks — your registration was received and is now{" "}
                  <strong>pending review</strong>. This is your site&apos;s API
                  key:
                </p>
                <div className="text-left">
                  <TokenReveal
                    plaintext={state.apiKey}
                    instruction="Paste this into your site's Alpine Central Server page, then press Download. It starts working once an administrator approves the connection. If it is lost, the administrator can issue a new one from Connections."
                  />
                </div>
              </>
            ) : (
              <p className="text-sm">
                Thanks — this lodge is already registered and its connection is
                handled by the central server&apos;s administrator. You&apos;ll be
                contacted at the email you provided; a new API key can be issued
                from Connections if yours is lost.
              </p>
            )}
            <Button asChild variant="outline" className="w-full">
              <Link href="/">Back to home</Link>
            </Button>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Lodge / club name</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">Unique code</Label>
              <Input id="code" name="code" placeholder="e.g. RUAPEHU-LODGE" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">Location (optional)</Label>
              <Input id="location" name="location" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactEmail">Contact email</Label>
              <Input id="contactEmail" name="contactEmail" type="email" required />
            </div>
            <RegisterLodgePicker options={lodgeOptions} />
            <div className="space-y-2">
              <Label htmlFor="notes">Notes for the administrator (optional)</Label>
              <textarea
                id="notes"
                name="notes"
                maxLength={500}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="For example: our lodge is not in the list yet — it is Tukino Lodge, Tukino village."
              />
            </div>
            {state.error ? (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Submitting…" : "Submit registration"}
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already an admin?{" "}
          <Link href="/login" className="underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
