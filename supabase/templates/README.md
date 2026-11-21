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
