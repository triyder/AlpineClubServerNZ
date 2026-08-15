import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@prisma/client";
import { sessionMaxAgeSeconds, sessionSecret } from "@/lib/env";

export const SESSION_COOKIE = "acs_session";

export interface SessionPayload {
  userId: string;
  email: string;
  role: Role;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(sessionSecret());
}

/**
 * Sign a session payload into a signed JWT (HS256). Pure and runtime-agnostic
 * (no cookies / no `server-only`), so it is safe to unit-test and to use from
 * both the Node server and the Edge middleware.
 */
export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${sessionMaxAgeSeconds()}s`)
    .sign(secretKey());
}

/** Verify a JWT and return its payload, or null if invalid/expired. Pure. */
export async function verifySession(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
    });
    if (
      typeof payload.userId === "string" &&
      typeof payload.email === "string" &&
      typeof payload.role === "string"
    ) {
      return {
        userId: payload.userId,
        email: payload.email,
        role: payload.role as Role,
      };
    }
    return null;
  } catch {
    return null;
  }
}
