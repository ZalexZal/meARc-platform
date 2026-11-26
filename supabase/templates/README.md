# Auth email templates

Made by `tools/email-templates.py`; edit the texts there and run it again.
Paste each one in Supabase: Authentication -> Emails -> Templates.
Sender (SMTP Settings): name `meARc`, the project Gmail.

| Supabase template | Subject | Body (paste the whole file) |
|---|---|---|
| Confirm signup | `Потвърди имейла си за meARc · Confirm your email` | `confirmation.html` |
| Reset Password | `Нова парола за meARc · Reset your password` | `recovery.html` |
| Magic Link | `Вход за родители в meARc · Parent sign-in` | `magic_link.html` |
| Change Email Address | `Потвърди новия си имейл · Confirm your new email` | `email_change.html` |
| Reauthentication | `Код за потвърждение за meARc · Verification code` | `reauthentication.html` |

The logo is served by the site at `/email/mearc-logo.png` (web/public/email).
"Magic Link" goes only to parents (consent page and the app's parent request).

## Sending

Supabase sends these through its custom SMTP settings (Project Settings ->
Authentication -> SMTP Settings): Gmail's SMTP server, the project Gmail as
user and sender, and a Gmail app password as the password. The app password lives
only in `~/keys/gmail-app-password.txt` and in the Supabase dashboard, never in
this repository. Gmail suits a demo, not volume; the plan is Brevo once a domain
exists (see `docs/legal/processors.md`).

After the rename to meARc, check that Authentication -> URL Configuration still
lists the site (`https://artrails.netlify.app`) and the app's link scheme
(`mearc://`), and not only the old `artrail` one.
