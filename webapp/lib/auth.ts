import "server-only";

import bcrypt from "bcrypt";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { prisma } from "./prisma";
import { loginBlocked, recordLoginFailure, recordLoginSuccess } from "./auth/login-throttle";
import { getClientIp } from "./request";
import { loginSchema, normalizeUsername } from "./validation/auth";

export type SessionRole = "ADMIN" | "SUPERVISOR" | "TEACHER" | "STUDENT" | "GUARDIAN";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      role: SessionRole;
      username: string;
      mustChangePassword: boolean;
    };
  }

  interface User {
    role: SessionRole;
    username: string;
    mustChangePassword: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: SessionRole;
    username?: string;
    mustChangePassword?: boolean;
  }
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Username and password",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        const parsed = loginSchema.safeParse(credentials ?? {});
        if (!parsed.success) return null;

        const { username, password } = parsed.data;
        const ip = getClientIp(req.headers);
        // D90: 3 wrong passwords block this sign-in for 15 minutes (lib/auth/login-throttle.ts).
        if (loginBlocked(username, ip)) return null;

        const user = await prisma.user.findFirst({
          where: { username: normalizeUsername(username) },
          select: {
            id: true,
            username: true,
            displayName: true,
            email: true,
            passwordHash: true,
            role: true,
            isActive: true,
            mustChangePassword: true,
          },
        });

        if (!user || !user.isActive) {
          recordLoginFailure(username, ip);
          return null;
        }

        const passwordValid = await bcrypt.compare(password, user.passwordHash);
        if (!passwordValid) {
          recordLoginFailure(username, ip);
          return null;
        }
        recordLoginSuccess(username, ip);

        return {
          id: user.id,
          name: user.displayName,
          email: user.email,
          role: user.role,
          username: user.username,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.username = user.username;
        token.mustChangePassword = user.mustChangePassword;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub ?? "";
      session.user.role = token.role ?? "STUDENT";
      session.user.username = token.username ?? "";
      session.user.mustChangePassword = token.mustChangePassword ?? false;
      return session;
    },
  },
};
