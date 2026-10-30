"use client";

import { useActionState } from "react";
import Link from "next/link";
import { PublicHeader } from "@/components/book/public-header";
import { loginAction, type LoginState } from "./actions";
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

const initialState: LoginState = {};

/** The sign-in form. `next` is where to go afterwards; the action re-checks it. */
export function LoginForm({ next }: { next: string | null }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PublicHeader current="login" />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Admin sign in</CardTitle>
          <CardDescription>
            Access the AlpineClubServerNZ oversight console.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {state.error ? (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Registering a lodge?{" "}
            <Link href="/register" className="underline underline-offset-4">
              Request a connection
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
    </div>
  );
}
