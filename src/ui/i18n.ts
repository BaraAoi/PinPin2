/** Minimal i18n: Russian by default, English toggle. */
export type Lang = 'ru' | 'en';

type Dict = Record<string, [string, string]>;

const D: Dict = {
  'menu.players': ['1–10 игроков · в среднем 4', '1–10 players · 4 on average'],
  'menu.nickname': ['Позывной', 'Callsign'],
  'menu.mic': ['Микрофон', 'Microphone'],
  'menu.micHint': ['Громкость микрофона', 'Microphone level'],
  'menu.sens': ['Чувствительность голоса', 'Voice sensitivity'],
  'menu.lang': ['Язык', 'Language'],
  'menu.single': ['Одиночная вылазка', 'Solo expedition'],
  'menu.host': ['Создать хаб', 'Host a hub'],
  'menu.join': ['Подключиться', 'Join'],
  'menu.joinGo': ['Войти', 'Enter'],
  'menu.about': ['Ночной лес слышит тебя. Крикни — и увидишь эхо. Но и они услышат.', 'The night forest hears you. Shout and you will see the echo. But so will they.'],
  'menu.controls': ['Управление', 'Controls'],
  'menu.features': ['Особенности', 'Features'],
  'menu.footNote': ['Наушники обязательны — слушай лес.', 'Headphones recommended — listen to the forest.'],
  'ctrl.move': ['движение', 'move'],
  'ctrl.run': ['бег', 'sprint'],
  'ctrl.crouch': ['красться', 'sneak'],
  'ctrl.jump': ['прыжок', 'jump'],
  'ctrl.use': ['взаимодействие', 'interact'],
  'ctrl.ping': ['голос / эхолокация', 'voice / echolocation'],
  'ctrl.inv': ['3D-инвентарь', '3D backpack'],
  'ctrl.clock': ['часы-«касио»', 'Casio watch'],
  'ctrl.pause': ['пауза', 'pause'],
  'feat.1': ['Эхолокация: крик, микрофон, эхо-силуэты', 'Echolocation: shout, mic, echo silhouettes'],
  'feat.2': ['Ночь длиннее дня, лес генерируется процедурно', 'Night outlasts day, the forest is procedural'],
  'feat.3': ['Хаб: модели игроков и настройка микрофона', 'Hub: player models and mic setup'],
  'feat.4': ['Библиотекарь: враг, идущий на звук', 'The Librarian: a foe that hunts sound'],
  'feat.5': ['P2P-хостинг в браузере', 'Peer-to-peer hosting in the browser'],

  'hub.sub': ['ХАБ · ЛАГЕРЬ У КОСТРА', 'HUB · CAMP BY THE FIRE'],
  'hub.micVol': ['Громкость микрофона', 'Microphone level'],
  'hub.micSens': ['Чувствительность', 'Sensitivity'],
  'hub.micSel': ['Вход', 'Input'],
  'hub.vol': ['Общая громкость', 'Master volume'],
  'hub.micNote': ['Скажи что-нибудь — полоска должна шевелиться.', 'Say something — the meter should move.'],
  'hub.micOff': ['Микрофон недоступен. Голосовые импульсы будут только по кнопке Q.', 'Microphone unavailable. Voice pulses will only work with Q.'],
  'hub.start': ['В лес', 'Into the forest'],
  'hub.ready': ['Готов', 'Ready'],
  'hub.readyOn': ['Готов ✓', 'Ready ✓'],
  'hub.leave': ['В меню', 'Main menu'],
  'hub.tip': ['ЛКМ — вращать камеру · колесо — приблизить · WASD — ходить по лагерю', 'LMB orbit · wheel zoom · WASD walk around the camp'],
  'hub.code': ['КОД ХАБА', 'HUB CODE'],
  'hub.players': ['ИГРОКИ', 'PLAYERS'],
  'hub.solo': ['ОДИН', 'SOLO'],
  'hub.waiting': ['Ожидание игроков…', 'Waiting for players…'],
  'hub.you': ['ТЫ', 'YOU'],
  'hub.voiceOn': ['Голос включён', 'Voice on'],
  'hub.voiceOff': ['Голос выключен', 'Voice off'],
  'hub.copy': ['Скопировать код', 'Copy code'],
  'hub.copied': ['Код скопирован', 'Code copied'],
  'hub.startHint': ['Готовы? Нажми «В лес».', 'Ready? Press "Into the forest".'],
  'hub.notAllReady': ['Не все готовы — старт принудительно', 'Not everyone is ready — forcing start'],
  'hub.joinTitle': ['Подключаемся к хабу…', 'Connecting to hub…'],

  'hud.noise': ['ШУМ', 'NOISE'],
  'hud.speaking': ['МИКРОФОН', 'MIC'],
  'hud.downed': ['Ты упал', 'You are down'],
  'hud.downedHint': ['Товарищи могут поднять тебя, если услышат шёпот. В одиночку — вернись в хаб.', 'Allies can revive you if they hear the whisper. Alone — return to the hub.'],
  'hud.toHub': ['В хаб', 'To hub'],
  'hud.map': ['КАРТА · ТОЛЬКО ПАМЯТЬ', 'MAP · MEMORY ONLY'],
  'hud.pingReady': ['Q · КРИК', 'Q · SHOUT'],
  'hud.pingCooldown': ['Вдох…', 'Inhale…'],
  'hud.stamina': ['ВЫНОСЛИВОСТЬ', 'STAMINA'],
  'hud.tapes': ['КАССЕТЫ', 'TAPES'],
  'hud.tapesAtTower': ['Отнеси кассеты на радиовышку', 'Bring the tapes to the radio tower'],
  'hud.towerReady': ['Все кассеты собраны', 'All tapes collected'],
  'hud.towerHint': ['Радиовышка: включи записи на пульте', 'Radio tower: play the tapes at the console'],
  'hud.phaseNight': ['НОЧЬ', 'NIGHT'],
  'hud.phaseDawn': ['РАССВЕТ', 'DAWN'],
  'hud.phaseDay': ['ДЕНЬ', 'DAY'],
  'hud.phaseDusk': ['ЗАКАТ', 'DUSK'],
  'hud.nightApproach': ['Темнеет. Скоро они выйдут.', 'Getting dark. They will come out soon.'],
  'hud.dawn': ['Светает. Они уходят.', 'Dawning. They are retreating.'],
  'hud.inventory': ['РЮКЗАК', 'BACKPACK'],
  'hud.watchRaised': ['Часы подняты', 'Watch raised'],
  'hud.alone': ['Ты один в лесу', 'You are alone in the forest'],
  'hud.team': ['В лесу: {n}', 'In the forest: {n}'],
  'hud.echo': ['ЭХО', 'ECHO'],
  'hud.watchBattery': ['БАТАРЕЯ', 'BATTERY'],
  'hud.ready': ['ГОТОВ', 'READY'],
  'hud.connecting': ['СВЯЗЬ…', 'CONNECTING…'],
  'hud.offline': ['ОФЛАЙН', 'OFFLINE'],
  'hud.you': ['ТЫ', 'YOU'],
  'watch.lower': ['опустить руку', 'lower the arm'],
  'watch.raised': ['Часы · Casio DW-1969', 'Watch · Casio DW-1969'],
  'poi.chapel': ['Часовня', 'Chapel'],
  'poi.cabin': ['Изба охотника', 'Hunter\u2019s cabin'],
  'poi.plane': ['Упавший самолёт', 'Crashed plane'],
  'poi.lumber': ['Лесопилка', 'Lumber camp'],
  'poi.tower': ['Радиовышка', 'Radio tower'],
  'poi.mounds': ['Курганы', 'Burial mounds'],
  'poi.bunker': ['Бункер', 'Bunker'],
  'poi.shrine': ['Капище', 'Shrine'],
  'poi.stones': ['Каменный круг', 'Stone circle'],
  'poi.watchtower': ['Смотровая вышка', 'Watchtower'],
  'poi.carwreck': ['Разбитая машина', 'Car wreck'],
  'poi.well': ['Колодец', 'Well'],
  'poi.camp': ['Лагерь', 'Camp'],
  'poi.discovered': ['Обнаружено: {name}', 'Discovered: {name}'],
  'combat.stun': ['Существо оглушено', 'The creature is stunned'],
  'combat.noKnife': ['Нужен нож', 'A knife is required'],
  'combat.swing': ['Ты ударил ножом', 'You swung the knife'],
  'revive.hint': ['E · поднять {name}', 'E · revive {name}'],
  'revive.done': ['{name} снова на ногах', '{name} is back on their feet'],
  'enemy.close': ['Оно совсем рядом', 'It is right here'],
  'mic.auto': ['Голосовой импульс', 'Voice pulse'],
  'flare.ready': ['Фальшфейер горит', 'Flare burning'],
  'watch.battery': ['Батарея {n}%', 'Battery {n}%'],

  'pause.title': ['ПАУЗА', 'PAUSED'],
  'pause.resume': ['Продолжить', 'Resume'],
  'pause.help': ['Управление', 'Controls'],
  'pause.hub': ['В хаб', 'Back to hub'],
  'pause.menu': ['Главное меню', 'Main menu'],

  'help.title': ['КАК ВЫЖИТЬ В ЛЕСУ', 'HOW TO SURVIVE THE FOREST'],
  'help.intro': ['Ночь длиннее дня. В темноте ты почти слеп: голос — твой фонарь.', 'Night is longer than day. In the dark you are nearly blind: your voice is the torch.'],
  'help.ping': ['Q — крикнуть. Волна звука обрисует лес и предметы. Микрофон делает то же, если громко говорить или кричать.', 'Q — shout. The sound wave outlines the forest and loot. The microphone does the same when you speak up.'],
  'help.enemy': ['Библиотекарь слеп, но слышит шаги, крики и ракеты. Красться (Ctrl) и стоять — безопасно. Костёр у лагеря они не трогают.', 'The Librarian is blind but hears steps, shouts and flares. Sneak (Ctrl) and stand still to be safe. It never enters the campfire light.'],
  'help.loot': ['Ищи кассеты в интересных местах. Принеси 5 кассет на радиовышку.', 'Find tapes in the interesting places. Bring 5 tapes to the radio tower.'],
  'help.inv': ['Tab — 3D-инвентарь: перетаскивай предметы, R — повернуть.', 'Tab — 3D backpack: drag items, R to rotate.'],
  'help.watch': ['C — поднять часы. Как у военных: лицом внутрь, к себе.', 'C — raise the watch. Worn like soldiers do: face inward, toward you.'],
  'help.multi': ['Хост в браузере. До 10 игроков; в среднем играют вчетвером.', 'Host in the browser. Up to 10 players; four is the average squad.'],

  'inv.title': ['РЮКЗАК', 'BACKPACK'],
  'inv.drag': ['взять / перетащить', 'pick up / drag'],
  'inv.rotate': ['повернуть предмет', 'rotate item'],
  'inv.orbit': ['вращать камеру', 'orbit camera'],
  'inv.close': ['закрыть', 'close'],
  'inv.foot': ['Всё, что ты несёшь, звенит и шуршит. Библиотекарь это слышит.', 'Everything you carry clinks and rustles. The Librarian hears it.'],
  'inv.use': ['Использовать', 'Use'],
  'inv.drop': ['Выбросить', 'Drop'],
  'inv.rotateBtn': ['Повернуть · R', 'Rotate · R'],
  'inv.tapes': ['КАССЕТЫ', 'TAPES'],
  'inv.empty': ['Пустой слот', 'Empty slot'],
  'inv.selectHint': ['Выбери предмет в рюкзаке.', 'Select an item in the backpack.'],
  'inv.full': ['Рюкзак полон', 'Backpack is full'],

  'loot.take': ['E · взять {item}', 'E · take {item}'],
  'loot.locked': ['Заперто. Нужен ключ.', 'Locked. A key is required.'],
  'loot.taken': ['Взято: {item}', 'Taken: {item}'],
  'loot.pick': ['E · подобрать', 'E · pick up'],
  'loot.keyUsed': ['Ключ использован', 'Key used'],
  'loot.full': ['Нет места в рюкзаке', 'No room in the backpack'],

  'use.medkit': ['Ты перевязал раны.', 'You bandaged your wounds.'],
  'use.can': ['Ты быстро поел. Стало легче.', 'You ate quickly. Feeling better.'],
  'use.stone': ['Эхо-камень треснул — лес ответил.', 'The echo stone cracked — the forest answered.'],
  'use.flare': ['Фальшфейер зажжён. Не держи его долго.', 'The flare is lit. Do not hold it for long.'],
  'use.compass': ['Компас: север отмечен на карте.', 'Compass: north is marked on the map.'],
  'use.fragment': ['Ты разобрал обрывок карты — метка на карте.', 'You studied the map fragment — a marker appeared.'],
  'use.battery': ['Батарейка вставлена в часы.', 'Battery installed in the watch.'],
  'use.lantern': ['Фонарь зажжён. Тебя видно.', 'Lantern lit. You can be seen.'],
  'use.tape': ['Кассета: голос шепчет о радиовышке.', 'Tape: a voice whispers about the radio tower.'],
  'use.none': ['Это нельзя использовать.', 'This cannot be used.'],

  'toast.joined': ['{name} присоединился', '{name} joined'],
  'toast.left': ['{name} покинул лес', '{name} left the forest'],
  'toast.revived': ['{name} поднял тебя', '{name} revived you'],
  'toast.downed': ['Ты упал. Позови на помощь!', 'You are down. Call for help!'],
  'toast.quest': ['Кассета {n}/5', 'Tape {n}/5'],
  'toast.questDone': ['Все кассеты собраны. Радиовышка ждёт.', 'All tapes collected. The radio tower awaits.'],
  'toast.win': ['Плёнка проиграна. Лес затих. Вы выжили.', 'The tape played. The forest fell silent. You survived.'],
  'toast.tower': ['Пульт радиовышки: нажми E', 'Radio console: press E'],
  'toast.towerLocked': ['Нужно 5 кассет', 'You need 5 tapes'],
  'toast.enemyNear': ['Оно рядом. Замри.', 'It is close. Freeze.'],
  'toast.lostSignal': ['Связь с хабом потеряна', 'Lost connection to the hub'],
  'toast.saved': ['Запись сохранена', 'Game saved'],
  'toast.reconnect': ['Переподключение…', 'Reconnecting…'],

  'death.title': ['ТЕБЯ УСЛЫШАЛИ', 'THEY HEARD YOU'],
  'death.respawn': ['Очнуться у костра', 'Wake up at the campfire'],
  'death.wait': ['Ждать товарищей…', 'Waiting for allies…'],
  'death.menu': ['В главное меню', 'Main menu'],

  'loading': ['Лес просыпается…', 'The forest wakes…'],
  'error.mic': ['Микрофон недоступен. Разреши доступ в браузере.', 'Microphone unavailable. Allow access in the browser.'],
  'error.host': ['Не удалось создать хаб. Проверь интернет.', 'Could not create a hub. Check your connection.'],
  'error.join': ['Хаб не найден. Проверь код.', 'Hub not found. Check the code.'],
  'error.full': ['Хаб заполнен (10 игроков).', 'Hub is full (10 players).'],
  'error.name': ['Введи позывной.', 'Enter a callsign.'],
  'connecting': ['Соединение…', 'Connecting…'],
  'waitingHost': ['Ожидание хоста…', 'Waiting for host…'],
  'single': ['ОДИН', 'SOLO'],
  'bytes': ['P2P · WebRTC', 'P2P · WebRTC'],
};

export function t(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const entry = D[key];
  let text = entry ? entry[lang === 'ru' ? 0 : 1] : key;
  if (params) {
    for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

export function applyI18n(root: ParentNode, lang: Lang): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (!key) return;
    el.textContent = t(lang, key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.dataset.i18nTitle;
    if (!key) return;
    el.title = t(lang, key);
  });
}

export function phaseLabelI18n(lang: Lang, phase: string): string {
  const map: Record<string, string> = {
    night: 'hud.phaseNight',
    dawn: 'hud.phaseDawn',
    day: 'hud.phaseDay',
    dusk: 'hud.phaseDusk',
  };
  return t(lang, map[phase] ?? 'hud.phaseNight');
}

export const HELP_KEYS = ['help.intro', 'help.ping', 'help.enemy', 'help.loot', 'help.inv', 'help.watch', 'help.multi'];
