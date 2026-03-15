const jsonHeaders = {
  "content-type": "application/json; charset=UTF-8",
  "cache-control": "no-store"
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: jsonHeaders
  });
}

export function wantsJson(request) {
  const accept = request.headers.get("accept") || "";
  return accept.includes("application/json") || request.headers.get("x-requested-with") === "fetch";
}

export function redirectToContact(request, params) {
  const url = new URL(request.url);
  url.pathname = "/contact/";
  url.search = "";

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  return Response.redirect(url.toString(), 303);
}

export function redirectToPrayer(request, params) {
  const url = new URL(request.url);
  url.pathname = "/prayer/";
  url.search = "";

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  return Response.redirect(url.toString(), 303);
}

export function cleanLine(value, maxLength = 500) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function cleanBlock(value, maxLength = 4000) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, maxLength);
}

export function normalizeEmail(value) {
  return cleanLine(value, 320).toLowerCase();
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isUSRequest(request) {
  const headerCountry = request?.headers?.get?.("cf-ipcountry") || null;
  const cfCountry = headerCountry || request?.cf?.country || null;

  if (!cfCountry) {
    return true;
  }

  return String(cfCountry).toUpperCase() === "US";
}

async function ensureColumns(db, tableName, columns) {
  const existing = await db.prepare(`PRAGMA table_info(${tableName})`).all();
  const names = new Set((existing.results || []).map((column) => column.name));

  for (const column of columns) {
    if (!names.has(column.name)) {
      await db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${column.definition}`).run();
    }
  }
}

export async function ensureSchema(db) {
  if (!db) {
    throw new Error("SITE_DATA binding is missing.");
  }

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        message TEXT NOT NULL,
        email_status TEXT NOT NULL DEFAULT 'pending',
        email_error TEXT,
        google_sheets_status TEXT NOT NULL DEFAULT 'pending',
        google_sheets_error TEXT,
        google_sheets_synced_at TEXT,
        submitted_at TEXT NOT NULL
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS newsletter_signups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL DEFAULT 'website',
        google_sheets_status TEXT NOT NULL DEFAULT 'pending',
        google_sheets_error TEXT,
        google_sheets_synced_at TEXT,
        subscribed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS prayer_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT,
        phone TEXT,
        request TEXT NOT NULL,
        google_sheets_status TEXT NOT NULL DEFAULT 'pending',
        google_sheets_error TEXT,
        google_sheets_synced_at TEXT,
        submitted_at TEXT NOT NULL
      )
    `)
    .run();

  await ensureColumns(db, "contact_messages", [
    { name: "google_sheets_status", definition: "google_sheets_status TEXT NOT NULL DEFAULT 'pending'" },
    { name: "google_sheets_error", definition: "google_sheets_error TEXT" },
    { name: "google_sheets_synced_at", definition: "google_sheets_synced_at TEXT" }
  ]);

  await ensureColumns(db, "newsletter_signups", [
    { name: "google_sheets_status", definition: "google_sheets_status TEXT NOT NULL DEFAULT 'pending'" },
    { name: "google_sheets_error", definition: "google_sheets_error TEXT" },
    { name: "google_sheets_synced_at", definition: "google_sheets_synced_at TEXT" }
  ]);

  await ensureColumns(db, "prayer_requests", [
    { name: "email", definition: "email TEXT" },
    { name: "phone", definition: "phone TEXT" },
    { name: "google_sheets_status", definition: "google_sheets_status TEXT NOT NULL DEFAULT 'pending'" },
    { name: "google_sheets_error", definition: "google_sheets_error TEXT" },
    { name: "google_sheets_synced_at", definition: "google_sheets_synced_at TEXT" }
  ]);
}
