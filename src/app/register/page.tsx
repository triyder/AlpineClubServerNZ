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

const initialState: RegisterState = {};

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState(
    registerAction,
    initialState,
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Register a lodge</CardTitle>
          <CardDescription>
            Submit your lodge details to request a connection to the central
            server. An administrator will review and, once approved, issue an
            API key for your AlpineClubBookingsNZ installation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.success ? (
            <div className="space-y-4 text-center">
              <p className="text-sm">
                Thanks — your registration was received and is now{" "}
                <strong>pending review</strong>. You&apos;ll be contacted at the
                email you provided once it&apos;s approved.
              </p>
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
                <Input
                  id="code"
                  name="code"
                  placeholder="e.g. RUAPEHU-LODGE"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Location (optional)</Label>
                <Input id="location" name="location" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactEmail">Contact email</Label>
                <Input
                  id="contactEmail"
                  name="contactEmail"
                  type="email"
                  required
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
    </main>
  );
}
