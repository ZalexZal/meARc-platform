/**
 * Every string on the site, in both languages.
 *
 * Bulgarian is the default and is written first, because it is the language the
 * audience actually reads and a translation written second tends to be the one
 * that sounds translated. English is a real translation rather than the source.
 *
 * Bulgarian runs roughly 15-25% longer than English for the same sentence. Any
 * component that only survives one of the two is not finished, so both are
 * typeset in every layout rather than checked at the end.
 */

export const languages = { bg: 'Български', en: 'English' } as const;
export const defaultLang = 'bg';
export type Lang = keyof typeof languages;

export const ui = {
  bg: {
    'meta.title': 'AR Trail — маршрути с добавена реалност',
    'meta.description':
      'Маркери, закотвени по истинските улици. Създай маршрут, дай код и пусни хората да го извървят.',

    'nav.how': 'Как работи',
    'nav.games': 'Маршрути',
    'nav.board': 'Класация',
    'nav.faq': 'Въпроси',
    'nav.signin': 'Вход',
    'nav.signup': 'Регистрация',
    'nav.create': 'Създай маршрут',
    'nav.account': 'Профил',
    'nav.menu': 'Меню',
    'nav.theme': 'Смени темата',
    'nav.lang': 'Смени езика',

    'hero.eyebrow': 'Ямбол · 42.4841, 26.5060',
    'hero.title': 'Маркерът стои на улицата.',
    'hero.lede':
      'Не на екрана, не в списък — на място. Отиваш до ъгъла, вдигаш телефона и той е там, закотвен за координатите, на които е поставен.',
    'hero.cta': 'Виж как работи',
    'hero.secondary': 'Създай маршрут',
    'hero.scroll': 'Превърти',

    'route.eyebrow': 'Маршрутът',
    'route.title': 'Спирка по спирка, из целия град.',
    'route.lede':
      'Създателят пуска маркери върху карта. Ходещият ги намира в реда, който създателят е избрал — или най-близкия неотворен, ако маршрутът няма ред.',

    'stop.1.name': 'Безистен',
    'stop.1.body':
      'Тръгваш от центъра. Телефонът показва посоката и разстоянието, не отговора.',
    'stop.2.name': 'Ески джамия',
    'stop.2.body':
      'Стигаш. Маркерът се появява на самата сграда — текст, видео или въпрос, каквото създателят е сложил.',
    'stop.3.name': 'Часовниковата кула',
    'stop.3.body':
      'Отговаряш. Проверката става на сървъра, така че отговорът никога не стои на телефона ти.',

    'modes.eyebrow': 'Три режима',
    'modes.title': 'Един маршрут, три различни игри.',
    'modes.guide.name': 'Воден',
    'modes.guide.body':
      'За обиколки и училищни екскурзии. Спирките са в ред, няма точки и няма класация. Работи и без интернет.',
    'modes.freefall.name': 'Свободен',
    'modes.freefall.body':
      'Без ред. Приложението сочи най-близкия маркер, който още никой от отбора не е отворил.',
    'modes.ctf.name': 'Състезание',
    'modes.ctf.body':
      'Въпроси, точки и класация на живо. Отбори от 1 до 4 души. Иска регистрация и връзка.',

    'stats.markers': 'маркера в Ямбол',
    'stats.accuracy': 'точност на закотвяне',
    'stats.languages': 'езика в едно приложение',

    'games.eyebrow': 'Публични маршрути',
    'games.title': 'Какво може да се извърви сега.',
    'games.empty': 'Още няма публикуван публичен маршрут.',
    'games.emptyBody':
      'Частните маршрути не се показват тук. Ако имаш код, въведи го направо в приложението.',
    'games.stops': 'спирки',
    'games.teams': 'отбора',
    'games.open': 'Отвори',
    'games.loading': 'Зареждане…',
    'games.failed': 'Списъкът не се зареди. Провери връзката и опитай пак.',

    'faq.eyebrow': 'Въпроси',
    'faq.title': 'Това, което хората питат преди да тръгнат.',
    'faq.q1': 'Трябва ли ми регистрация?',
    'faq.a1':
      'За воден и свободен маршрут — не. Отваряш приложението и тръгваш. За състезателен трябва, защото класация с анонимни участници не значи нищо и не може да се оспори после.',
    'faq.q2': 'Работи ли без интернет?',
    'faq.a2':
      'Картата и маркерите — да, веднъж заредени. Проверката на отговори — не. Отговорите се проверяват на сървъра именно за да не стоят на телефона предварително, така че състезателен маршрут иска мобилни данни. Същото важи и за другите две игри в града.',
    'faq.q3': 'Какъв телефон трябва?',
    'faq.a3':
      'Android с ARCore и Google Play Services for AR. iOS предстои. Нужни са камера, GPS и заредена батерия — обиколката е пеша и трае час-два.',
    'faq.q4': 'Кой може да прави маршрути?',
    'faq.a4':
      'Всеки с регистрация. Маршрутът тръгва частен и в чернова; вижда се само от теб, докато ти не решиш друго.',
    'faq.q5': 'Какво става с данните ми?',
    'faq.a5':
      'Можеш да свалиш всичко, което системата знае за теб, и да изтриеш профила си. И двете са бутони в профила, не молба по имейл.',

    'cta.title': 'Направи първия си маршрут.',
    'cta.body':
      'Пускаш маркери върху карта, пишеш какво има на всяка спирка и раздаваш код. Няма нужда от нищо друго.',
    'cta.button': 'Създай маршрут',

    'footer.tagline': 'Маркери, закотвени по истинските улици.',
    'footer.product': 'Продукт',
    'footer.legal': 'Правни',
    'footer.terms': 'Условия',
    'footer.privacy': 'Поверителност',
    'footer.contact': 'Контакт',
    'footer.rights': 'Всички права запазени.',

    'auth.signin.title': 'Вход',
    'auth.signup.title': 'Регистрация',
    'auth.email': 'Имейл',
    'auth.password': 'Парола',
    'auth.name': 'Име за показване',
    'auth.nameHelp': 'Това се вижда в класациите.',
    'auth.submitIn': 'Влез',
    'auth.submitUp': 'Създай профил',
    'auth.haveAccount': 'Вече имаш профил?',
    'auth.noAccount': 'Нямаш профил?',
    'auth.forgot': 'Забравена парола',
    'auth.checkInbox': 'Провери пощата си',
    'auth.checkInboxBody':
      'Изпратихме връзка за потвърждение. Профилът се активира след като я отвориш.',

    'err.generic': 'Нещо се обърка. Опитай пак.',
    'err.network': 'Няма връзка със сървъра. Провери интернета и опитай пак.',
    'err.badCredentials': 'Грешен имейл или парола.',
    'err.emailTaken': 'Вече има профил с този имейл. Опитай да влезеш.',
    'err.weakPassword': 'Паролата трябва да е поне 8 знака.',
  },

  en: {
    'meta.title': 'AR Trail — augmented reality city trails',
    'meta.description':
      'Markers anchored to real streets. Build a trail, hand out a code, and let people walk it.',

    'nav.how': 'How it works',
    'nav.games': 'Trails',
    'nav.board': 'Leaderboard',
    'nav.faq': 'Questions',
    'nav.signin': 'Sign in',
    'nav.signup': 'Sign up',
    'nav.create': 'Build a trail',
    'nav.account': 'Account',
    'nav.menu': 'Menu',
    'nav.theme': 'Switch theme',
    'nav.lang': 'Switch language',

    'hero.eyebrow': 'Yambol · 42.4841, 26.5060',
    'hero.title': 'The marker stands in the street.',
    'hero.lede':
      'Not on a screen, not in a list — in place. You walk to the corner, raise your phone, and it is there, anchored to the coordinates it was set on.',
    'hero.cta': 'See how it works',
    'hero.secondary': 'Build a trail',
    'hero.scroll': 'Scroll',

    'route.eyebrow': 'The route',
    'route.title': 'Stop by stop, across a whole town.',
    'route.lede':
      'A creator drops markers on a map. A walker finds them in the order the creator chose — or the nearest unopened one, if the trail has no order.',

    'stop.1.name': 'Bezisten',
    'stop.1.body':
      'You start in the centre. The phone gives you a bearing and a distance, not an answer.',
    'stop.2.name': 'Eski Mosque',
    'stop.2.body':
      'You arrive. The marker appears on the building itself — text, video or a question, whichever the creator put there.',
    'stop.3.name': 'The Clock Tower',
    'stop.3.body':
      'You answer. The check happens on the server, so the answer is never sitting on your phone.',

    'modes.eyebrow': 'Three modes',
    'modes.title': 'One trail, three different games.',
    'modes.guide.name': 'Guided',
    'modes.guide.body':
      'For tours and school trips. Stops run in order, nothing is scored, nobody is ranked. Works without a signal.',
    'modes.freefall.name': 'Freefall',
    'modes.freefall.body':
      'No order at all. The app points at the nearest marker nobody on your team has opened yet.',
    'modes.ctf.name': 'Competition',
    'modes.ctf.body':
      'Questions, points and a live leaderboard. Teams of one to four. Needs an account and a connection.',

    'stats.markers': 'markers in Yambol',
    'stats.accuracy': 'anchoring accuracy',
    'stats.languages': 'languages in one app',

    'games.eyebrow': 'Public trails',
    'games.title': 'What can be walked right now.',
    'games.empty': 'No public trail has been published yet.',
    'games.emptyBody':
      'Private trails are not listed here. If you have a code, type it straight into the app.',
    'games.stops': 'stops',
    'games.teams': 'teams',
    'games.open': 'Open',
    'games.loading': 'Loading…',
    'games.failed': 'The list did not load. Check your connection and try again.',

    'faq.eyebrow': 'Questions',
    'faq.title': 'What people ask before they set off.',
    'faq.q1': 'Do I need an account?',
    'faq.a1':
      'For guided and freefall trails, no. Open the app and start walking. For a competition you do, because a leaderboard of anonymous entries means nothing and cannot be contested afterwards.',
    'faq.q2': 'Does it work without a signal?',
    'faq.a2':
      'The map and the markers do, once loaded. Answer checking does not. Answers are checked on the server precisely so they are never sitting on your phone in advance, which means a competitive trail needs mobile data. Both reference city games in Bulgaria require the same.',
    'faq.q3': 'What phone do I need?',
    'faq.a3':
      'Android with ARCore and Google Play Services for AR. iOS is coming. You need a camera, GPS and a charged battery — the walk is on foot and takes an hour or two.',
    'faq.q4': 'Who can build trails?',
    'faq.a4':
      'Anyone with an account. A trail starts private and in draft; nobody sees it but you until you decide otherwise.',
    'faq.q5': 'What happens to my data?',
    'faq.a5':
      'You can download everything the system knows about you, and delete your account. Both are buttons in your profile, not an email you have to send.',

    'cta.title': 'Build your first trail.',
    'cta.body':
      'Drop markers on a map, write what stands at each stop, and hand out a code. Nothing else is needed.',
    'cta.button': 'Build a trail',

    'footer.tagline': 'Markers anchored to real streets.',
    'footer.product': 'Product',
    'footer.legal': 'Legal',
    'footer.terms': 'Terms',
    'footer.privacy': 'Privacy',
    'footer.contact': 'Contact',
    'footer.rights': 'All rights reserved.',

    'auth.signin.title': 'Sign in',
    'auth.signup.title': 'Create an account',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.name': 'Display name',
    'auth.nameHelp': 'This is what leaderboards show.',
    'auth.submitIn': 'Sign in',
    'auth.submitUp': 'Create account',
    'auth.haveAccount': 'Already have an account?',
    'auth.noAccount': 'No account yet?',
    'auth.forgot': 'Forgotten password',
    'auth.checkInbox': 'Check your inbox',
    'auth.checkInboxBody':
      'We sent a confirmation link. The account becomes active once you open it.',

    'err.generic': 'Something went wrong. Try again.',
    'err.network': 'No connection to the server. Check your internet and try again.',
    'err.badCredentials': 'Wrong email or password.',
    'err.emailTaken': 'There is already an account with that email. Try signing in.',
    'err.weakPassword': 'The password needs to be at least 8 characters.',
  },
} as const;

export type UIKey = keyof (typeof ui)['bg'];

/** The language a URL is in. Anything unprefixed is Bulgarian. */
export function langFromUrl(url: URL): Lang {
  const [, first] = url.pathname.split('/');
  return first in languages ? (first as Lang) : defaultLang;
}

/**
 * A lookup that falls back to Bulgarian rather than rendering a raw key.
 *
 * A missing string should look like an untranslated sentence, which somebody
 * will notice and fix, rather than like `faq.a3`, which reads as a broken page.
 */
export function useTranslations(lang: Lang) {
  return function t(key: UIKey): string {
    return (ui[lang] as Record<string, string>)[key] ?? ui[defaultLang][key];
  };
}

/** Prefixes a path for the language. Bulgarian has no prefix. */
export function localise(lang: Lang) {
  return function href(path: string): string {
    const clean = path.startsWith('/') ? path : `/${path}`;
    return lang === defaultLang ? clean : `/${lang}${clean}`;
  };
}
