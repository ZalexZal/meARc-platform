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

## Magic Link   (this is the email a PARENT receives)
Subject: Детето ви иска да ползва AR Trail · Your child wants to use AR Trail

<p>Здравейте,</p>
<p>Дете на 13 години посочи този имейл като имейл на родител или настойник, за да ползва AR Trail — приложение за градски маршрути с добавена реалност.</p>
<p>По закон под 14 години профилът може да се ползва само със съгласието на родител. Отворете линка, за да прочетете какво пазим и да решите:</p>
<p><a href="{{ .ConfirmationURL }}">Прочети и реши</a></p>
<p>Ако не познавате това дете, просто изтрийте писмото. Линкът важи един час; на същата страница може да поискате нов.</p>
<hr>
<p>Hello,</p>
<p>A 13-year-old gave this email as a parent's or guardian's, to use AR Trail - an app for augmented-reality city trails.</p>
<p>By law, under 14 the account can only be used with a parent's consent. Open the link to read what we keep and to decide:</p>
<p><a href="{{ .ConfirmationURL }}">Read and decide</a></p>
<p>If you don't know this child, just delete this email. The link works for one hour; you can ask for a new one on the same page.</p>

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
