const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_API_ROOT = "https://sheets.googleapis.com/v4/spreadsheets";

let cachedToken = null;

function readEnvValue(value) {
  const text = String(value || "").trim();
  return text || null;
}

function getConfig(env) {
  const spreadsheetId = readEnvValue(env.GOOGLE_SHEETS_SPREADSHEET_ID);
  const clientEmail = readEnvValue(env.GOOGLE_SHEETS_CLIENT_EMAIL);
  const privateKey = readEnvValue(env.GOOGLE_SHEETS_PRIVATE_KEY);

  if (!spreadsheetId && !clientEmail && !privateKey) {
    return null;
  }

  const missing = [];

  if (!spreadsheetId) {
    missing.push("GOOGLE_SHEETS_SPREADSHEET_ID");
  }

  if (!clientEmail) {
    missing.push("GOOGLE_SHEETS_CLIENT_EMAIL");
  }

  if (!privateKey) {
    missing.push("GOOGLE_SHEETS_PRIVATE_KEY");
  }

  if (missing.length > 0) {
    throw new Error(`Google Sheets sync is missing ${missing.join(", ")}.`);
  }

  return {
    spreadsheetId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, "\n"),
    contactTab: readEnvValue(env.GOOGLE_SHEETS_CONTACT_TAB) || "Contact Messages",
    signupsTab: readEnvValue(env.GOOGLE_SHEETS_SIGNUPS_TAB) || "Newsletter Signups",
    prayerTab: readEnvValue(env.GOOGLE_SHEETS_PRAYER_TAB) || "Prayer Requests"
  };
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeText(text) {
  return base64UrlEncodeBytes(new TextEncoder().encode(text));
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

async function createSignedJwt(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT"
  };
  const claimSet = {
    iss: clientEmail,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600
  };
  const encodedHeader = base64UrlEncodeText(JSON.stringify(header));
  const encodedClaimSet = base64UrlEncodeText(JSON.stringify(claimSet));
  const signingInput = `${encodedHeader}.${encodedClaimSet}`;
  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKey),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKey,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

async function getAccessToken(config) {
  const now = Math.floor(Date.now() / 1000);

  if (
    cachedToken &&
    cachedToken.clientEmail === config.clientEmail &&
    cachedToken.expiresAt > now + 60
  ) {
    return cachedToken.value;
  }

  const assertion = await createSignedJwt(config.clientEmail, config.privateKey);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }).toString()
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || `Google token request failed with ${response.status}.`);
  }

  if (!payload.access_token) {
    throw new Error("Google token response did not include an access token.");
  }

  cachedToken = {
    clientEmail: config.clientEmail,
    value: payload.access_token,
    expiresAt: now + Number(payload.expires_in || 3600)
  };

  return payload.access_token;
}

async function appendRow(config, sheetName, values) {
  const accessToken = await getAccessToken(config);
  const range = `${sheetName}!A:Z`;
  const response = await fetch(
    `${GOOGLE_SHEETS_API_ROOT}/${config.spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        majorDimension: "ROWS",
        values: [values]
      })
    }
  );

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const details = payload.error?.message || payload.error?.status;
    throw new Error(details || `Google Sheets append failed with ${response.status}.`);
  }

  return payload;
}

async function syncRow(env, sheetName, values) {
  try {
    const config = getConfig(env);

    if (!config) {
      return {
        status: "skipped",
        error: "Google Sheets sync is not configured.",
        syncedAt: null
      };
    }

    await appendRow(config, sheetName, values);

    return {
      status: "sent",
      error: null,
      syncedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      syncedAt: null
    };
  }
}

export async function syncContactMessageToGoogleSheets(env, submission) {
  const config = getConfig(env);
  const sheetName = config?.contactTab || "Contact Messages";

  return syncRow(env, sheetName, [
    submission.submittedAt,
    submission.name,
    submission.email,
    submission.message,
    submission.emailStatus
  ]);
}

export async function syncNewsletterSignupToGoogleSheets(env, signup) {
  const config = getConfig(env);
  const sheetName = config?.signupsTab || "Newsletter Signups";

  return syncRow(env, sheetName, [
    signup.subscribedAt,
    signup.email,
    signup.source
  ]);
}

export async function syncPrayerRequestToGoogleSheets(env, request) {
  const config = getConfig(env);
  const sheetName = config?.prayerTab || "Prayer Requests";

  return syncRow(env, sheetName, [
    request.submittedAt,
    request.name,
    request.email,
    request.phone,
    request.request
  ]);
}
