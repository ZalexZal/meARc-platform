# Terms — draft for review

> **Draft, 2026-08-30. Not in the app yet.** Written for Alex to correct before it
> goes into `AppStrings` in both languages. Version string once approved:
> `SupabaseConfig.termsVersion`, currently `2026-08-30`.

## What this is trying to be

Short enough to actually read, because a non-skippable screen that nobody reads
is a dark pattern with extra steps. Five things, plainly:

1. what the app does with where you are,
2. what happens to what you leave,
3. that other people's markers are theirs, not ours,
4. that the app is not a navigation system,
5. how to get rid of your data.

It is not a licence agreement. This is a school project with three markers in
Yambol; wording it like a bank would be both dishonest and unreadable. **It is
also not legal advice — if this ever goes to a real audience, someone qualified
should read it.**

---

## English

**Before you start**

**Where you are.** The app uses your location to show markers near you and to
place them in the camera view. Your position stays on your phone and is sent to
our server only as a "what is near this point" question. We do not keep a record
of where you have been.

**What you leave.** Markers you create are visible to everyone who can open that
trail. Do not put a marker on private property, on someone's home, or anywhere it
would cause a nuisance to the people who actually live there.

**What other people leave.** Anyone can place a marker. We do not check them
before they appear. If one bothers you, **Hide this marker** removes it from your
map immediately, and no one needs to agree with you first.

**Watch where you are going.** This is not a navigation app. It shows a straight
line to a marker, not a route, and it does not know about roads, traffic or
anything else in the way. Look up.

**Your account.** You can use the app without signing up. It still creates an
anonymous identity so it can remember which trails you have joined. Uninstalling
the app ends that identity and everything attached to it.

**Getting rid of it.** Deleting your account deletes your trails and every marker
in them. There is no undo.

*Accepting these terms records the date and the version against your account.*

---

## Bulgarian

**Преди да започнете**

**Къде се намирате.** Приложението използва местоположението ви, за да показва
маркери близо до вас и да ги поставя през камерата. Позицията ви остава на
телефона и се изпраща до сървъра само като въпрос „какво има близо до тази
точка“. Не пазим история къде сте били.

**Какво оставяте.** Маркерите, които създавате, са видими за всички, които имат
достъп до този маршрут. Не поставяйте маркер върху частен имот, върху нечий дом
или някъде, където би пречил на хората, които живеят там.

**Какво оставят другите.** Всеки може да постави маркер. Не ги проверяваме,
преди да се появят. Ако някой ви пречи, „Скрий този маркер“ го маха от вашата
карта веднага и никой не трябва да се съгласява с вас.

**Гледайте къде вървите.** Това не е навигация. Показва права линия до маркера, а
не маршрут, и не знае нищо за улици, движение или каквото и да е по пътя.
Вдигнете поглед.

**Профилът ви.** Може да използвате приложението без регистрация. То пак създава
анонимна самоличност, за да помни към кои маршрути сте се присъединили.
Изтриването на приложението прекратява тази самоличност и всичко към нея.

**Как да се откажете.** Изтриването на профила изтрива вашите маршрути и всички
маркери в тях. Няма връщане назад.

*Приемането записва датата и версията към профила ви.*

---

## Notes for the review

- **"We do not keep a record of where you have been" has to stay true.** Today it
  is: `markers_near` takes a point and returns rows, and nothing writes the
  point down. If analytics ever arrive, this line changes first.
- **The nuisance clause is deliberately about people, not law.** "Do not place
  markers on private property" is enforceable by nobody here; saying why makes it
  more likely to be followed than citing a statute would.
- **The navigation warning is not boilerplate.** The app draws a straight ray to
  a marker and says so in the code comments; a reader walking into a road while
  following it is a foreseeable outcome of a design decision we made on purpose.
- **Uninstall ends an anonymous identity** — worth stating, because it is
  surprising. There is no password, so there is nothing to prove a reinstall is
  the same person, and their joined trails are gone.
- Where to keep it: once approved, as `terms.body` in `AppStrings` alongside
  everything else, so the language switch reaches it too.
