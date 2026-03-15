# Google Sheets Sync Setup

The website now saves form submissions in Cloudflare D1 first, then tries to append them into Google Sheets.

## What syncs

- `Contact Messages` tab: one row per contact form submission
- `Newsletter Signups` tab: one row per unique signup email
- `Prayer Requests` tab: one row per prayer request submission

## Create the spreadsheet

1. Create a Google Sheets file.
2. Add three tabs named `Contact Messages`, `Newsletter Signups`, and `Prayer Requests`.
3. Add header rows.

Recommended headers for `Contact Messages`:

`Submitted At | Name | Email | Message | Email Status`

Recommended headers for `Newsletter Signups`:

`Subscribed At | Email | Source`

Recommended headers for `Prayer Requests`:

`Submitted At | Name | Email | Phone | Request`

## Create Google API access

1. In Google Cloud, enable the Google Sheets API for your project.
2. Create a service account.
3. Create a JSON key for that service account.
4. Copy the service account `client_email`.
5. Copy the service account `private_key`.
6. Share the spreadsheet with the service account email as an editor.

## Add Cloudflare secrets

Set these on the `grassroots-class-site` Pages project:

- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SHEETS_CLIENT_EMAIL`
- `GOOGLE_SHEETS_PRIVATE_KEY`

Optional variables already have defaults in `wrangler.toml`:

- `GOOGLE_SHEETS_CONTACT_TAB`
- `GOOGLE_SHEETS_SIGNUPS_TAB`
- `GOOGLE_SHEETS_PRAYER_TAB`

## Notes

- If Google Sheets is not configured yet, the website still saves every submission in D1.
- Contact messages, signups, and prayer requests store Google sync status in D1 so failed syncs can be identified and retried later.
