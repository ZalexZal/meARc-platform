#!/usr/bin/env python3
"""
Writes the Supabase auth email templates to supabase/templates/.

One layout, five emails. Edit the texts here and run it again:
    python3 tools/email-templates.py

The files are pasted into Supabase by hand (Authentication -> Emails ->
Templates); see supabase/templates/README.md for which file goes where.

Rules of the texts (Alex, 21 Nov 2026):
- Bulgarian first, a short English paragraph under it. Supabase does not know
  the reader's language when it sends.
- "ти" for users, "Вие" for the parent email, like the site.
- Sender name in Supabase: meARc.

Email HTML is old-fashioned on purpose: tables, inline styles, no web fonts,
a PNG logo (Gmail drops SVG), and a button made of a padded link so it works
in Outlook too.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "supabase" / "templates"
SITE = "https://artrails.netlify.app"
LOGO = SITE + "/email/mearc-logo.png"

# Site tokens (web/src/styles): ink, dim ink, line, signal blue, page.
INK = "#0a1418"
DIM = "#4a626e"
FAINT = "#7d95a0"
LINE = "#dde8ea"
BLUE = "#0066cc"
PAGE = "#f5f5f7"
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif"


def button(label: str, url: str) -> str:
    return f"""
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px">
  <tr><td style="border-radius:980px;background:{BLUE}">
    <a href="{url}" style="display:inline-block;padding:13px 28px;font-family:{FONT};font-size:17px;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:980px">{label}</a>
  </td></tr>
</table>"""


def code_box(code: str) -> str:
    return f"""
<div style="margin:28px 0 8px;padding:18px 0;border:1px solid {LINE};border-radius:14px;text-align:center;font-family:{FONT};font-size:32px;font-weight:600;letter-spacing:6px;color:{INK}">{code}</div>"""


def fallback_link(url: str, label: str) -> str:
    return f"""
<p style="margin:16px 0 0;font-family:{FONT};font-size:13px;line-height:1.5;color:{FAINT}">{label}<br>
<a href="{url}" style="color:{BLUE};word-break:break-all">{url}</a></p>"""


def page(*, preheader: str, title: str, body_bg: str, action: str, after_bg: str,
         title_en: str, body_en: str, footer_bg: str, footer_en: str) -> str:
    p = f"margin:0 0 14px;font-family:{FONT};font-size:17px;line-height:1.47;color:{INK}"
    small = f"margin:0 0 8px;font-family:{FONT};font-size:14px;line-height:1.5;color:{DIM}"
    return f"""<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{title}</title>
</head>
<body style="margin:0;padding:0;background:{PAGE}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">{preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{PAGE}">
<tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid {LINE};border-radius:18px">
    <tr><td style="padding:32px 32px 8px">
      <a href="{SITE}"><img src="{LOGO}" width="150" height="41" alt="meARc" style="display:block;border:0;width:150px;height:auto"></a>
    </td></tr>
    <tr><td style="padding:16px 32px 28px">
      <h1 style="margin:0 0 16px;font-family:{FONT};font-size:26px;line-height:1.15;font-weight:600;letter-spacing:-0.3px;color:{INK}">{title}</h1>
      {''.join(f'<p style="{p}">{line}</p>' for line in body_bg)}
      {action}
      {''.join(f'<p style="margin:20px 0 0;font-family:{FONT};font-size:14px;line-height:1.5;color:{DIM}">{line}</p>' for line in after_bg)}
    </td></tr>
    <tr><td style="padding:0 32px"><div style="border-top:1px solid {LINE};font-size:0;line-height:0">&nbsp;</div></td></tr>
    <tr><td lang="en" style="padding:20px 32px 28px">
      <p style="margin:0 0 6px;font-family:{FONT};font-size:14px;font-weight:600;line-height:1.4;color:{INK}">{title_en}</p>
      {''.join(f'<p style="{small}">{line}</p>' for line in body_en)}
    </td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
    <tr><td style="padding:20px 32px 0;font-family:{FONT};font-size:12px;line-height:1.5;color:{FAINT};text-align:center">
      {footer_bg}<br><span lang="en">{footer_en}</span><br>
      <a href="{SITE}" style="color:{FAINT}">meARc</a> &middot; приложение за маршрути с добавена реалност
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>
"""


URL = "{{ .ConfirmationURL }}"
COPY_BG = "Ако бутонът не работи, копирай този адрес в браузъра:"
HELLO = "{{ if .Data.display_name }}Здравей, {{ .Data.display_name }}!{{ else }}Здравей!{{ end }}"
AUTO_BG = "Този имейл е изпратен автоматично, не отговаряй на него."
AUTO_EN = "This email was sent automatically; please don't reply to it."

TEMPLATES = {
    # Sent when a new account must confirm its address. Off today
    # (accounts are confirmed automatically), ready for when it is on.
    "confirmation": dict(
        subject="Потвърди имейла си за meARc · Confirm your email",
        html=page(
            preheader="Остава една стъпка, за да е готов профилът ти.",
            title="Потвърди имейла си",
            body_bg=[HELLO, "Остава една стъпка: потвърди, че този адрес е твой, и профилът ти в meARc е готов."],
            action=button("Потвърди имейла", URL) + fallback_link(URL, COPY_BG),
            after_bg=["Ако профилът не е създаден от теб, просто игнорирай този имейл."],
            title_en="Confirm your email",
            body_en=["One step left: confirm this address is yours and your meARc account is ready. Use the button above. If you didn't sign up, ignore this email."],
            footer_bg=AUTO_BG, footer_en=AUTO_EN,
        ),
    ),
    "recovery": dict(
        subject="Нова парола за meARc · Reset your password",
        html=page(
            preheader="Линк за нова парола за профила ти в meARc.",
            title="Задай нова парола",
            body_bg=["Получихме заявка за нова парола за профила ти в meARc ({{ .Email }}).",
                     "Натисни бутона и избери нова парола. Линкът е за еднократна употреба и изтича след кратко време."],
            action=button("Задай нова парола", URL) + fallback_link(URL, COPY_BG),
            after_bg=["Ако не си поискал(а) нова парола, игнорирай този имейл. Сегашната ти парола остава."],
            title_en="Reset your password",
            body_en=["We received a request to reset the password of your meARc account. Use the button above to choose a new one. If it wasn't you, ignore this email; your password stays the same."],
            footer_bg=AUTO_BG, footer_en=AUTO_EN,
        ),
    ),
    # Supabase calls it "Magic Link". Only parents get it: the consent page
    # (site) and the app's "ask a parent" both send it. Formal "Вие".
    "magic_link": dict(
        subject="Вход за родители в meARc · Parent sign-in",
        html=page(
            preheader="Влезте в страницата за родители на meARc.",
            title="Вход за родители",
            body_bg=["Здравейте!",
                     "meARc е приложение за градски маршрути: детето върви по улиците, намира спирки на картата и през камерата и отговаря на въпроси, само или в отбор.",
                     "Натиснете бутона, за да влезете в страницата за родители. Там ще прочетете какво пазим за детето и кой какво вижда, ще дадете или откажете съгласие и можете да го оттеглите по всяко време."],
            action=button("Към страницата за родители", URL) + fallback_link(URL, "Ако бутонът не работи, копирайте този адрес в браузъра:"),
            after_bg=["Ако не очаквате този имейл, просто го игнорирайте. Без Вашето съгласие профилът на детето не се използва."],
            title_en="Parent sign-in",
            body_en=["meARc is an app for city trails with augmented reality. Use the button above to open the parents' page, where you can read what we keep about your child, give or refuse consent, and withdraw it at any time. If you weren't expecting this email, you can ignore it."],
            footer_bg="Този имейл е изпратен автоматично, моля, не отговаряйте на него.",
            footer_en=AUTO_EN,
        ),
    ),
    # Also used when a guest turns into an account: then there is no old
    # address, so the text names only the new one.
    "email_change": dict(
        subject="Потвърди новия си имейл · Confirm your new email",
        html=page(
            preheader="Потвърди имейла на профила си в meARc.",
            title="Потвърди новия имейл",
            body_bg=[HELLO,
                     "{{ if .Email }}Поиска имейлът на профила ти в meARc да стане {{ .NewEmail }} вместо {{ .Email }}.{{ else }}Поиска {{ .NewEmail }} да е имейлът на профила ти в meARc.{{ end }} Натисни бутона, за да потвърдиш."],
            action=button("Потвърди имейла", URL) + fallback_link(URL, COPY_BG),
            after_bg=["Ако не си искал(а) тази промяна, игнорирай този имейл. Имейлът на профила няма да се смени."],
            title_en="Confirm your new email",
            body_en=["Use the button above to confirm the new email address of your meARc account. If you didn't ask for this, ignore this email and nothing changes."],
            footer_bg=AUTO_BG, footer_en=AUTO_EN,
        ),
    ),
    # A code, not a link: asked before a sensitive change when Supabase's
    # "secure password change" is on.
    "reauthentication": dict(
        subject="Код за потвърждение за meARc · Verification code",
        html=page(
            preheader="Кодът ти за потвърждение в meARc.",
            title="Код за потвърждение",
            body_bg=["Въведи този код в meARc, за да потвърдиш промяната в профила си:"],
            action=code_box("{{ .Token }}"),
            after_bg=["Кодът изтича след кратко време. Ако не правиш промяна в профила си, игнорирай този имейл и смени паролата си."],
            title_en="Verification code",
            body_en=["Enter this code in meARc to confirm the change to your account. If it wasn't you, ignore this email and change your password."],
            footer_bg=AUTO_BG, footer_en=AUTO_EN,
        ),
    ),
}

# Supabase dashboard names, for the README.
NAMES = {
    "confirmation": "Confirm signup",
    "recovery": "Reset Password",
    "magic_link": "Magic Link",
    "email_change": "Change Email Address",
    "reauthentication": "Reauthentication",
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for key, t in TEMPLATES.items():
        (OUT / f"{key}.html").write_text(t["html"], encoding="utf-8")
        rows.append(f"| {NAMES[key]} | `{t['subject']}` | `{key}.html` |")
    (OUT / "README.md").write_text(
        "# Auth email templates\n\n"
        "Made by `tools/email-templates.py`; edit the texts there and run it again.\n"
        "Paste each one in Supabase: Authentication -> Emails -> Templates.\n"
        "Sender (SMTP Settings): name `meARc`, the project Gmail.\n\n"
        "| Supabase template | Subject | Body (paste the whole file) |\n|---|---|---|\n"
        + "\n".join(rows) + "\n\n"
        "The logo is served by the site at `/email/mearc-logo.png` (web/public/email).\n"
        "\"Magic Link\" goes only to parents (consent page and the app's parent request).\n",
        encoding="utf-8")
    print("wrote", ", ".join(f"{k}.html" for k in TEMPLATES), "and README.md to", OUT)


if __name__ == "__main__":
    main()
