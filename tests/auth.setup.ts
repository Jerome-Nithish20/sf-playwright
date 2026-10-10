import { test as setup, expect, request as apiRequest } from '@playwright/test';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

const authFile = path.resolve(__dirname, '../playwright/.auth/user.json');

/**
 * Logs in to Salesforce with the OAuth 2.0 JWT bearer flow, exchanges the access token
 * for session cookies via frontdoor.jsp, and saves them to disk. Every test reuses that
 * state, so no test logs in through the UI.
 *
 * JWT bearer needs no password and never triggers Salesforce's identity-verification
 * challenge, so this runs unattended in CI. No `page` fixture is used — the exchange is
 * plain HTTP, and an APIRequestContext's storageState() is the same format a browser
 * context consumes.
 */
setup('authenticate', async () => {
  const { SF_LOGIN_URL, SF_CLIENT_ID, SF_USERNAME, SF_JWT_KEY } = process.env;
  if (!SF_LOGIN_URL || !SF_CLIENT_ID || !SF_USERNAME) {
    throw new Error('Missing SF_LOGIN_URL / SF_CLIENT_ID / SF_USERNAME — is .env loaded?');
  }

  // CI supplies the key as a secret; locally it sits in an untracked file.
  const privateKey =
    SF_JWT_KEY ?? fs.readFileSync(path.resolve(__dirname, '../server.key'), 'utf8');

  const assertion = jwt.sign(
    {
      iss: SF_CLIENT_ID,
      sub: SF_USERNAME,
      aud: 'https://login.salesforce.com',
    },
    privateKey,
    { algorithm: 'RS256', expiresIn: '3m' },
  );

  const ctx = await apiRequest.newContext();

  const tokenResponse = await ctx.post(`${SF_LOGIN_URL}/services/oauth2/token`, {
    form: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    },
  });
  expect(tokenResponse.status(), await tokenResponse.text()).toBe(200);
  const { access_token, instance_url, scope } = await tokenResponse.json();

  // frontdoor.jsp only issues a session cookie for tokens carrying the `web` scope.
  expect(scope, `Token scope is "${scope}" — frontdoor.jsp requires "web"`).toContain('web');

  // Trade the access token for session cookies. The context follows the redirect
  // chain and collects Set-Cookie headers along the way.
  const frontdoor = await ctx.get(`${instance_url}/secur/frontdoor.jsp`, {
    params: { sid: access_token, retURL: '/lightning' },
  });
  expect(frontdoor.ok(), `frontdoor returned ${frontdoor.status()}`).toBeTruthy();

  const state = await ctx.storageState({ path: authFile });
  const sessionCookie = state.cookies.find((c) => c.name === 'sid');
  expect(sessionCookie, 'No `sid` cookie — session exchange failed').toBeDefined();

  await ctx.dispose();
});
