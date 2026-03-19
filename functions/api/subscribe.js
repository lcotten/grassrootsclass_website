import {
  cleanLine,
  ensureSchema,
  isUSRequest,
  isValidEmail,
  json,
  normalizeEmail,
  redirectToContact,
  wantsJson
} from "../_lib/form-utils.js";
import { syncNewsletterSignupToGoogleSheets } from "../_lib/google-sheets.js";

function invalid(request, message) {
  if (wantsJson(request)) {
    return json({ ok: false, message }, 400);
  }

  return redirectToContact(request, { subscribe: "error", message });
}

function blocked(request) {
  const message = "Sorry, this form is only available in the United States.";

  if (wantsJson(request)) {
    return json({ ok: false, message }, 403);
  }

  return redirectToContact(request, { subscribe: "error", message });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!isUSRequest(request)) {
      return blocked(request);
    }

    const form = await request.formData();

    if (cleanLine(form.get("website"))) {
      if (wantsJson(request)) {
        return json({ ok: true, message: "Thanks. You're on the list." });
      }

      return redirectToContact(request, { subscribe: "success" });
    }

    const firstName = cleanLine(form.get("first-name"), 120);
    const lastName = cleanLine(form.get("last-name"), 120);
    const email = normalizeEmail(form.get("subscribe-email"));

    if (!firstName) {
      return invalid(request, "Please enter your first name.");
    }

    if (!lastName) {
      return invalid(request, "Please enter your last name.");
    }

    if (!isValidEmail(email)) {
      return invalid(request, "Please enter a valid email address.");
    }

    await ensureSchema(env.SITE_DATA);

    const timestamp = new Date().toISOString();
    const existingSignup = await env.SITE_DATA
      .prepare(`
        SELECT id, subscribed_at, google_sheets_status
        FROM newsletter_signups
        WHERE email = ?
      `)
      .bind(email)
      .first();
    let signupId = existingSignup?.id;
    const subscribedAt = existingSignup?.subscribed_at || timestamp;

    if (signupId) {
      await env.SITE_DATA
        .prepare(`
          UPDATE newsletter_signups
          SET first_name = ?, last_name = ?, updated_at = ?
          WHERE id = ?
        `)
        .bind(firstName, lastName, timestamp, signupId)
        .run();
    } else {
      const insertResult = await env.SITE_DATA
        .prepare(`
          INSERT INTO newsletter_signups (first_name, last_name, email, source, subscribed_at, updated_at)
          VALUES (?, ?, ?, 'website', ?, ?)
        `)
        .bind(firstName, lastName, email, subscribedAt, timestamp)
        .run();
      signupId = insertResult.meta?.last_row_id;
    }

    let googleSheetsStatus = existingSignup?.google_sheets_status || "pending";
    let emailStatus = "skipped";
    let emailError = null;

    if (env.CONTACT_MAILER) {
      try {
        const mailerResponse = await env.CONTACT_MAILER.fetch("https://mailer.internal/send", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            type: "subscribe",
            firstName,
            lastName,
            email,
            submittedAt: subscribedAt
          })
        });

        if (!mailerResponse.ok) {
          const payload = await mailerResponse.json().catch(() => ({}));
          throw new Error(payload.message || `Mailer error: ${mailerResponse.status}`);
        }

        emailStatus = "sent";
      } catch (error) {
        emailStatus = "failed";
        emailError = error instanceof Error ? error.message : String(error);
        console.error("Signup email send failed", emailError);
      }
    }

    if (signupId && googleSheetsStatus !== "sent") {
      const googleSheetsResult = await syncNewsletterSignupToGoogleSheets(env, {
        subscribedAt,
        firstName,
        lastName,
        email,
        source: "website"
      });
      googleSheetsStatus = googleSheetsResult.status;

      await env.SITE_DATA
        .prepare(`
          UPDATE newsletter_signups
          SET google_sheets_status = ?, google_sheets_error = ?, google_sheets_synced_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .bind(
          googleSheetsResult.status,
          googleSheetsResult.error,
          googleSheetsResult.syncedAt,
          timestamp,
          signupId
        )
        .run();
    }

    const responseMessage = "Thanks. You're signed up for email updates.";

    if (wantsJson(request)) {
      return json({ ok: true, message: responseMessage, googleSheetsStatus, emailStatus, emailError });
    }

    return redirectToContact(request, { subscribe: "success" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save your subscription right now.";
    console.error("Subscribe handler failed", message);

    if (wantsJson(request)) {
      return json({ ok: false, message }, 500);
    }

    return redirectToContact(request, { subscribe: "error", message });
  }
}
