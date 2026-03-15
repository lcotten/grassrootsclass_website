import {
  cleanBlock,
  cleanLine,
  ensureSchema,
  isValidEmail,
  isUSRequest,
  json,
  normalizeEmail,
  redirectToPrayer,
  wantsJson
} from "../_lib/form-utils.js";
import { syncPrayerRequestToGoogleSheets } from "../_lib/google-sheets.js";

function invalid(request, message) {
  if (wantsJson(request)) {
    return json({ ok: false, message }, 400);
  }

  return redirectToPrayer(request, { prayer: "error", message });
}

function blocked(request) {
  const message = "Sorry, this form is only available in the United States.";

  if (wantsJson(request)) {
    return json({ ok: false, message }, 403);
  }

  return redirectToPrayer(request, { prayer: "error", message });
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
        return json({ ok: true, message: "Thanks. Your request has been received." });
      }

      return redirectToPrayer(request, { prayer: "success" });
    }

    const name = cleanLine(form.get("name"), 120);
    const email = normalizeEmail(form.get("email"));
    const phone = cleanLine(form.get("phone"), 40);
    const requestText = cleanBlock(form.get("request"), 4000);

    if (email && !isValidEmail(email)) {
      return invalid(request, "Please enter a valid email address.");
    }

    if (!requestText) {
      return invalid(request, "Please enter a prayer request before submitting.");
    }

    await ensureSchema(env.SITE_DATA);

    const submittedAt = new Date().toISOString();
    const nameValue = name || null;
    const emailValue = email || null;
    const phoneValue = phone || null;

    const insertResult = await env.SITE_DATA
      .prepare(`
        INSERT INTO prayer_requests (name, email, phone, request, submitted_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .bind(nameValue, emailValue, phoneValue, requestText, submittedAt)
      .run();

    const requestId = insertResult.meta?.last_row_id;
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
            type: "prayer",
            name,
            email,
            phone,
            request: requestText,
            submittedAt
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
        console.error("Prayer email send failed", emailError);
      }
    }
    const googleSheetsResult = await syncPrayerRequestToGoogleSheets(env, {
      submittedAt,
      name: name || "",
      email: email || "",
      phone: phone || "",
      request: requestText
    });

    if (requestId) {
      await env.SITE_DATA
        .prepare(`
          UPDATE prayer_requests
          SET google_sheets_status = ?, google_sheets_error = ?, google_sheets_synced_at = ?
          WHERE id = ?
        `)
        .bind(
          googleSheetsResult.status,
          googleSheetsResult.error,
          googleSheetsResult.syncedAt,
          requestId
        )
        .run();
    }

    const responseMessage = "Thanks. Your prayer request has been received.";

    if (wantsJson(request)) {
      return json({
        ok: true,
        message: responseMessage,
        googleSheetsStatus: googleSheetsResult.status,
        emailStatus,
        emailError
      });
    }

    return redirectToPrayer(request, { prayer: "success" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save your request right now.";
    console.error("Prayer request handler failed", message);

    if (wantsJson(request)) {
      return json({ ok: false, message }, 500);
    }

    return redirectToPrayer(request, { prayer: "error", message });
  }
}
