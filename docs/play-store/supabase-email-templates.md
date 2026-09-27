# Supabase → Authentication → Emails → Templates

All four are bilingual (Bulgarian first, English under a rule), because the
sender cannot know which language the reader chose. {{ .ConfirmationURL }} is
Supabase's own placeholder; leave it exactly as written.

## Confirm signup
Subject: Потвърди имейла си · Confirm your email — AR Trail

<p>Здравей,</p>
<p>Някой направи профил в AR Trail с този имейл. Ако си ти, отвори линка, за да го потвърдиш:</p>
<p><a href="{{ .ConfirmationURL }}">Потвърди имейла</a></p>
<p>Ако не си бил ти, просто изтрий това писмо.</p>
<hr>
<p>Hello,</p>
<p>Someone made an AR Trail account with this email. If it was you, open the link to confirm it:</p>
<p><a href="{{ .ConfirmationURL }}">Confirm your email</a></p>
<p>If it wasn't you, just delete this email.</p>

## Change Email Address   (also sent when a guest in the app makes an account)
Subject: Потвърди имейла си · Confirm your email — AR Trail

<p>Здравей,</p>
<p>Поискано е този имейл да стане имейлът на профил в AR Trail. Ако си ти, отвори линка:</p>
<p><a href="{{ .ConfirmationURL }}">Потвърди имейла</a></p>
<p>Ако си направил профила в приложението, върни се в него след това.</p>
<p>Ако не си бил ти, изтрий това писмо — нищо няма да се промени.</p>
<hr>
<p>Hello,</p>
<p>Someone asked for this email to become the email of an AR Trail account. If it was you, open the link:</p>
<p><a href="{{ .ConfirmationURL }}">Confirm your email</a></p>
<p>If you made the account in the app, go back to it afterwards.</p>
<p>If it wasn't you, delete this email and nothing will change.</p>

## Magic Link   (parents: sign-in to the parent account, and a child's request)
Subject: Вход в AR Trail · Sign in to AR Trail

<p>Здравейте,</p>
<p>Ето линкът за вход в родителския ви профил в AR Trail. Ако дете на 13 години е посочило този имейл като имейл на родител или настойник, ще видите искането му веднага след като влезете, и ще можете да се съгласите или да откажете.</p>
<p><a href="{{ .ConfirmationURL }}">Влез</a></p>
<p>Ако не сте поискали това и не познавате такова дете, просто изтрийте писмото. Линкът важи един час.</p>
<hr>
<p>Hello,</p>
<p>Here is your sign-in link to your AR Trail parent account. If a 13-year-old gave this email as a parent's or guardian's, you will see their request as soon as you sign in, and can agree or refuse.</p>
<p><a href="{{ .ConfirmationURL }}">Sign in</a></p>
<p>If you didn't ask for this and don't know such a child, just delete this email. The link works for one hour.</p>

## Reset Password
Subject: Нова парола · New password — AR Trail

<p>Здравей,</p>
<p>Поискана е нова парола за профила ти в AR Trail. Отвори линка, за да я зададеш:</p>
<p><a href="{{ .ConfirmationURL }}">Задай нова парола</a></p>
<p>Ако не си бил ти, изтрий писмото — паролата ти остава същата.</p>
<hr>
<p>Hello,</p>
<p>Someone asked for a new password for your AR Trail account. Open the link to set it:</p>
<p><a href="{{ .ConfirmationURL }}">Set a new password</a></p>
<p>If it wasn't you, delete this email - your password stays the same.</p>
