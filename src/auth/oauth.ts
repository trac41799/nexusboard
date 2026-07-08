import passport from 'passport';
import {
  Strategy as GoogleStrategy,
  Profile as GoogleProfile,
  VerifyCallback,
} from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import prisma from '../lib/prisma';
import { OAuthProfile } from './types';

/**
 * Passport is used purely as a transient authentication mechanism for the OAuth
 * redirect dance. We do NOT use sessions — instead each strategy resolves a
 * normalised {@link OAuthProfile}, the callback route provisions/looks up the
 * user, and we hand back our own JWTs. `session: false` is set on the routes.
 */

const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000';

/** True when the given provider's client credentials are configured. */
export function isProviderConfigured(provider: 'google' | 'github'): boolean {
  if (provider === 'google') {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  }
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

/**
 * Finds an existing user by (provider, oauthId), otherwise links to an existing
 * account with the same email, otherwise creates a fresh account. Returns the
 * minimal identity needed to mint JWTs.
 */
export async function findOrCreateOAuthUser(
  profile: OAuthProfile,
): Promise<{ id: string; email: string }> {
  const existingByOAuth = await prisma.user.findFirst({
    where: { oauthProvider: profile.provider, oauthId: profile.oauthId },
  });
  if (existingByOAuth) {
    return { id: existingByOAuth.id, email: existingByOAuth.email };
  }

  const existingByEmail = await prisma.user.findUnique({ where: { email: profile.email } });
  if (existingByEmail) {
    const linked = await prisma.user.update({
      where: { id: existingByEmail.id },
      data: {
        oauthProvider: profile.provider,
        oauthId: profile.oauthId,
        avatarUrl: existingByEmail.avatarUrl ?? profile.avatarUrl,
      },
    });
    return { id: linked.id, email: linked.email };
  }

  const created = await prisma.user.create({
    data: {
      email: profile.email,
      name: profile.name ?? profile.email,
      avatarUrl: profile.avatarUrl,
      oauthProvider: profile.provider,
      oauthId: profile.oauthId,
    },
  });
  return { id: created.id, email: created.email };
}

function normaliseGoogle(profile: GoogleProfile): OAuthProfile {
  const email = profile.emails?.[0]?.value;
  if (!email) {
    throw new Error('Google profile did not include an email address');
  }
  return {
    provider: 'google',
    oauthId: profile.id,
    email,
    name: profile.displayName ?? null,
    avatarUrl: profile.photos?.[0]?.value ?? null,
  };
}

// passport-github2 lacks first-class typings; model the fields we consume.
interface GitHubProfile {
  id: string;
  displayName?: string;
  username?: string;
  emails?: Array<{ value: string }>;
  photos?: Array<{ value: string }>;
}

function normaliseGitHub(profile: GitHubProfile): OAuthProfile {
  const email = profile.emails?.[0]?.value ?? `${profile.username ?? profile.id}@users.noreply.github.com`;
  return {
    provider: 'github',
    oauthId: profile.id,
    email,
    name: profile.displayName ?? profile.username ?? null,
    avatarUrl: profile.photos?.[0]?.value ?? null,
  };
}

/**
 * Registers the Google and GitHub passport strategies for whichever providers
 * have credentials configured. Safe to call once at startup.
 */
export function configurePassport(): void {
  if (isProviderConfigured('google')) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          callbackURL: `${APP_BASE_URL}/api/auth/oauth/google/callback`,
          scope: ['profile', 'email'],
        },
        async (
          _accessToken: string,
          _refreshToken: string,
          profile: GoogleProfile,
          done: VerifyCallback,
        ) => {
          try {
            const user = await findOrCreateOAuthUser(normaliseGoogle(profile));
            done(null, user);
          } catch (err) {
            done(err as Error);
          }
        },
      ),
    );
  }

  if (isProviderConfigured('github')) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: process.env.GITHUB_CLIENT_ID as string,
          clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
          callbackURL: `${APP_BASE_URL}/api/auth/oauth/github/callback`,
          scope: ['user:email'],
        },
        async (
          _accessToken: string,
          _refreshToken: string,
          profile: GitHubProfile,
          done: (error: unknown, user?: { id: string; email: string }) => void,
        ) => {
          try {
            const user = await findOrCreateOAuthUser(normaliseGitHub(profile));
            done(null, user);
          } catch (err) {
            done(err);
          }
        },
      ),
    );
  }
}

export { passport };
