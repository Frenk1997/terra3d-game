// Terra 3D — игровые данные: ресурсы, планеты, эпохи, постройки, перки, косметика.
// Числа баланса подобраны симуляцией (см. tools/ в истории разработки).
'use strict';

const GAME_VERSION = 3; // формат сохранения

const RES = {
  // Земля
  solar:    { name: 'Солнце',    icon: '☀️', tint: 'rgba(251,191,36,0.18)' },
  water:    { name: 'Вода',      icon: '💧', tint: 'rgba(56,189,248,0.18)' },
  air:      { name: 'Воздух',    icon: '💨', tint: 'rgba(148,163,184,0.2)' },
  biomass:  { name: 'Биомасса',  icon: '🌱', tint: 'rgba(52,211,153,0.18)' },
  science:  { name: 'Наука',     icon: '🔬', tint: 'rgba(167,139,250,0.2)' },
  // Марс
  regolith: { name: 'Реголит',   icon: '🏜️', tint: 'rgba(234,88,12,0.22)' },
  ice:      { name: 'Лёд',       icon: '❄️', tint: 'rgba(125,211,252,0.2)' },
  iron:     { name: 'Железо',    icon: '⚙️', tint: 'rgba(148,163,184,0.22)' },
  oxygen:   { name: 'Кислород',  icon: '🅾️', tint: 'rgba(103,232,249,0.2)' },
  // Юпитер
  hydrogen: { name: 'Водород',   icon: '🎈', tint: 'rgba(251,146,60,0.2)' },
  energy:   { name: 'Энергия',   icon: '⚡', tint: 'rgba(250,204,21,0.2)' },
  helium:   { name: 'Гелий-3',   icon: '✨', tint: 'rgba(216,180,254,0.22)' },
  metal:    { name: 'Мет. водород', icon: '💠', tint: 'rgba(96,165,250,0.22)' },
  // общий
  gems:     { name: 'Кристаллы', icon: '💎', tint: 'rgba(192,132,252,0.25)' }
};

// u — эпоха (этап), с которой постройка открывается; tab — вкладка a/b/c
const PLANETS = {
  earth: {
    name: 'Земля', icon: '🌍', stageWord: 'Эпоха', clickRes: 'solar',
    res: ['solar', 'water', 'air', 'biomass', 'science'],
    start: { solar: 100, water: 50 },
    defaultBg: 'bg-default',
    tabs: [
      { id: 'a', icon: '⚡', label: 'Стихии' },
      { id: 'b', icon: '🌱', label: 'Жизнь' },
      { id: 'c', icon: '🏛️', label: 'Цивилизация' }
    ],
    eras: [
      { name: 'Протопланета',        desc: 'Раскалённый шар лавы и вулканов. Здесь всё только начинается.', click: 1,    halo: '#f97316' },
      { name: 'Первичный океан',     desc: 'Кометы принесли воду — планету покрыл бескрайний океан.', click: 3,    halo: '#0ea5e9', cost: { solar: 150, water: 60 } },
      { name: 'Рождение атмосферы',  desc: 'Гейзеры и вулканы наполнили небо газами. Появились облака.', click: 7,    halo: '#38bdf8', cost: { solar: 350, water: 200, air: 100 } },
      { name: 'Первая жизнь',        desc: 'В тёплых морях зародились первые микробы и водоросли.', click: 15,   halo: '#2dd4bf', cost: { water: 900, air: 600, biomass: 60 } },
      { name: 'Расцвет биосферы',    desc: 'Континенты зазеленели, воздух стал пригодным для дыхания.', click: 30,   halo: '#22c55e', cost: { water: 3000, air: 2500, biomass: 900 } },
      { name: 'Эпоха гигантов',      desc: 'По планете бродят исполинские ящеры, джунгли до небес.', click: 60,   halo: '#16a34a', cost: { solar: 7000, air: 5000, biomass: 3000 } },
      { name: 'Первые цивилизации',  desc: 'Огонь, земледелие и первые города. Появилась наука.', click: 120,  halo: '#eab308', cost: { solar: 25000, water: 18000, biomass: 12000 } },
      { name: 'Индустриальная эра',  desc: 'Фабрики, железные дороги и смог над мегаполисами.', click: 260,  halo: '#f59e0b', cost: { solar: 90000, biomass: 40000, science: 2000 } },
      { name: 'Космическая эра',     desc: 'Ракеты уходят к звёздам. Открыт путь к Марсу!', click: 550,  halo: '#60a5fa', cost: { solar: 350000, air: 150000, science: 12000 } },
      { name: 'Звёздная империя',    desc: 'Рой Дайсона питает цивилизацию, покоряющую систему.', click: 1200, halo: '#c084fc', cost: { solar: 1800000, water: 600000, science: 80000 } }
    ],
    buildings: [
      { id: 'solar_collector', tab: 'a', u: 0, name: 'Поглотитель света',   icon: '🔆', desc: 'Улавливает солнечные фотоны.', cost: { solar: 15 }, prod: { solar: 2.5 } },
      { id: 'ice_comet',       tab: 'a', u: 0, name: 'Притяжение комет',    icon: '☄️', desc: 'Направляет ледяные кометы в океаны.', cost: { solar: 30 }, prod: { water: 1.8 } },
      { id: 'geyser',          tab: 'a', u: 1, name: 'Гейзеры',             icon: '🌋', desc: 'Выбрасывают пар и газы.', cost: { solar: 75, water: 25 }, prod: { water: 3.5, air: 1.8 } },
      { id: 'gas_separator',   tab: 'a', u: 2, name: 'Ионизатор неба',      icon: '🌪️', desc: 'Формирует воздушный слой.', cost: { solar: 220, water: 120 }, prod: { air: 6.5 } },
      { id: 'thunderstorm',    tab: 'a', u: 4, name: 'Грозовые фронты',     icon: '🌩️', desc: 'Молнии заряжают атмосферу.', cost: { solar: 2500, air: 1200 }, prod: { solar: 40, air: 15 } },
      { id: 'ocean_currents',  tab: 'a', u: 5, name: 'Океанские течения',   icon: '🌊', desc: 'Перемешивают тепло и воду.', cost: { solar: 9000, water: 6000 }, prod: { water: 120, solar: 60 } },
      { id: 'cyanobacteria',   tab: 'b', u: 2, name: 'Цианобактерии',       icon: '🦠', desc: 'Первые микробы выделяют кислород.', cost: { solar: 180, water: 100, air: 30 }, prod: { air: 4.5, biomass: 1.8 } },
      { id: 'coral_reef',      tab: 'b', u: 3, name: 'Коралловые рифы',     icon: '🐚', desc: 'Богатые подводные экосистемы.', cost: { water: 450, air: 250, biomass: 40 }, prod: { biomass: 5.5, water: 6 } },
      { id: 'relic_forest',    tab: 'b', u: 4, name: 'Реликтовые леса',     icon: '🌲', desc: 'Озеленяют континенты.', cost: { solar: 800, water: 600, biomass: 180 }, prod: { air: 16, biomass: 13 } },
      { id: 'fauna',           tab: 'b', u: 5, name: 'Гиганты',             icon: '🦕', desc: 'Исполинские ящеры удобряют землю.', cost: { air: 5000, biomass: 2500 }, prod: { biomass: 70 } },
      { id: 'tribes',          tab: 'b', u: 6, name: 'Первые племена',      icon: '🔥', desc: 'Огонь, орудия и первые знания.', cost: { solar: 20000, biomass: 9000 }, prod: { biomass: 120, science: 4 } },
      { id: 'farms',           tab: 'b', u: 6, name: 'Земледелие',          icon: '🌾', desc: 'Поля кормят растущие народы.', cost: { water: 30000, biomass: 15000 }, prod: { biomass: 400, science: 3 } },
      { id: 'ancient_academy', tab: 'c', u: 6, name: 'Библиотеки',          icon: '🏛️', desc: 'Хранят и умножают знания.', cost: { solar: 30000, biomass: 12000 }, prod: { science: 15, solar: 150 } },
      { id: 'factories',       tab: 'c', u: 7, name: 'Фабрики',             icon: '🏭', desc: 'Паровые машины и конвейеры.', cost: { solar: 120000, science: 2500 }, prod: { solar: 1500, science: 40 } },
      { id: 'eco_city',        tab: 'c', u: 7, name: 'Мегаполисы',          icon: '🏙️', desc: 'Огни городов видны из космоса.', cost: { solar: 250000, air: 80000, science: 6000 }, prod: { science: 250, solar: 1200, biomass: 600 } },
      { id: 'spaceport',       tab: 'c', u: 8, name: 'Космодром',           icon: '🚀', desc: 'Запуски к другим мирам.', cost: { solar: 900000, science: 30000 }, prod: { science: 1200, solar: 6000 } },
      { id: 'orbital_mirror',  tab: 'c', u: 8, name: 'Орбитальные зеркала', icon: '🛰️', desc: 'Собирают свет на орбите.', cost: { solar: 2000000, science: 80000 }, prod: { solar: 25000, air: 5000 } },
      { id: 'dyson_swarm',     tab: 'c', u: 9, name: 'Рой Дайсона',         icon: '🌞', desc: 'Мегаструктура вокруг Солнца.', cost: { solar: 15000000, science: 800000 }, prod: { solar: 250000, water: 60000, air: 60000, science: 20000 } }
    ],
    perks: [
      { id: 'gaia',      name: 'Дыхание Геи',     icon: '🌿', type: 'prod',  step: 0.25, max: 5, base: 1, scale: 1.8, desc: 'Постройки Земли производят больше.' },
      { id: 'tectonics', name: 'Тектоника',       icon: '🌋', type: 'click', step: 0.5,  max: 5, base: 1, scale: 1.8, desc: 'Тапы по Земле сильнее.' },
      { id: 'oceans',    name: 'Мудрость океанов', icon: '🌊', type: 'cheap', step: 0.08, max: 5, base: 1, scale: 1.8, desc: 'Постройки и эпохи Земли дешевле.' }
    ]
  },

  mars: {
    name: 'Марс', icon: '🔴', stageWord: 'Этап', clickRes: 'regolith',
    res: ['regolith', 'ice', 'iron', 'oxygen'],
    start: { regolith: 50 },
    defaultBg: 'bg-mars',
    unlock: { earthEra: 8, cost: { 'earth:solar': 500000, 'earth:science': 20000 } },
    tabs: [
      { id: 'a', icon: '⛏️', label: 'Добыча' },
      { id: 'b', icon: '🏠', label: 'База' },
      { id: 'c', icon: '🌿', label: 'Терраформ' }
    ],
    eras: [
      { name: 'Красная пустыня',     desc: 'Холодная пыльная планета. Высадка прошла успешно!', click: 2,  halo: '#ea580c' },
      { name: 'Первая база',         desc: 'Жилые модули и марсоходы. Колония растёт.', click: 5,  halo: '#f97316', cost: { regolith: 400, ice: 150 } },
      { name: 'Ледяные шахты',       desc: 'Подлёдная вода превращается в топливо и воздух.', click: 12, halo: '#fb923c', cost: { regolith: 2500, ice: 1200, iron: 300 } },
      { name: 'Города под куполами', desc: 'Под прозрачными куполами цветут сады.', click: 30, halo: '#fdba74', cost: { ice: 8000, iron: 9000, oxygen: 2500 } },
      { name: 'Зелёный Марс',        desc: 'Атмосфера, моря и голубое небо. Марс ожил!', click: 80, halo: '#5eead4', cost: { regolith: 120000, iron: 50000, oxygen: 40000 } }
    ],
    buildings: [
      { id: 'rover',      tab: 'a', u: 0, name: 'Марсоход',         icon: '🚙', desc: 'Собирает реголит.', cost: { regolith: 20 }, prod: { regolith: 3 } },
      { id: 'ice_drill',  tab: 'a', u: 0, name: 'Ледяной бур',      icon: '❄️', desc: 'Добывает подповерхностный лёд.', cost: { regolith: 45 }, prod: { ice: 2 } },
      { id: 'iron_mine',  tab: 'a', u: 1, name: 'Железный рудник',  icon: '⛏️', desc: 'Красная пыль — это ржавчина!', cost: { regolith: 200, ice: 60 }, prod: { iron: 2.5 } },
      { id: 'comet_tug',  tab: 'a', u: 2, name: 'Ледяные кометы',   icon: '☄️', desc: 'Буксиры роняют кометы на полюса.', cost: { regolith: 4000, iron: 900 }, prod: { ice: 45 } },
      { id: 'hab',        tab: 'b', u: 1, name: 'Жилой модуль',     icon: '🏠', desc: 'Дом первых колонистов.', cost: { regolith: 350, iron: 40 }, prod: { oxygen: 1.2, regolith: 6 } },
      { id: 'greenhouse', tab: 'b', u: 2, name: 'Теплица',          icon: '🌱', desc: 'Растения дают кислород.', cost: { ice: 1200, iron: 350 }, prod: { oxygen: 7 } },
      { id: 'reactor',    tab: 'b', u: 3, name: 'Реактор',          icon: '⚛️', desc: 'Энергия для плавильных печей.', cost: { iron: 6000, oxygen: 2000 }, prod: { regolith: 150, iron: 40 } },
      { id: 'dome',       tab: 'c', u: 3, name: 'Купол-город',      icon: '🌐', desc: 'Сады под прозрачным куполом.', cost: { iron: 12000, oxygen: 5000 }, prod: { oxygen: 80, ice: 50 } },
      { id: 'magnet',     tab: 'c', u: 4, name: 'Магнитный щит',    icon: '🧲', desc: 'Защищает атмосферу от солнечного ветра.', cost: { regolith: 150000, iron: 60000 }, prod: { oxygen: 500, ice: 300, iron: 100 } },
      { id: 'mars_seas',  tab: 'c', u: 4, name: 'Марсианские моря', icon: '🌊', desc: 'Растопленные полюса стали морями.', cost: { ice: 200000, oxygen: 80000 }, prod: { ice: 1500, oxygen: 900 } }
    ],
    perks: [
      { id: 'dust_filters', name: 'Пылевые фильтры',   icon: '🌪️', type: 'prod',  step: 0.25, max: 5, base: 2, scale: 1.8, desc: 'Постройки Марса производят больше.' },
      { id: 'low_gravity',  name: 'Низкая гравитация', icon: '🌒', type: 'click', step: 0.5,  max: 5, base: 2, scale: 1.8, desc: 'Тапы по Марсу сильнее.' },
      { id: 'drones',       name: 'Рой дронов',        icon: '🚁', type: 'cheap', step: 0.08, max: 5, base: 2, scale: 1.8, desc: 'Постройки и этапы Марса дешевле.' }
    ]
  },

  jupiter: {
    name: 'Юпитер', icon: '🟠', stageWord: 'Этап', clickRes: 'hydrogen',
    res: ['hydrogen', 'energy', 'helium', 'metal'],
    start: { hydrogen: 60 },
    defaultBg: 'bg-jupiter',
    unlock: { earthEra: 9, stages: { mars: 2 }, cost: { 'earth:solar': 4000000, 'earth:science': 250000, 'mars:iron': 15000 } },
    tabs: [
      { id: 'a', icon: '🎈', label: 'Газ' },
      { id: 'b', icon: '⚡', label: 'Энергия' },
      { id: 'c', icon: '🛰️', label: 'Орбита' }
    ],
    eras: [
      { name: 'Газовый гигант',     desc: 'Бескрайние облака и вечные бури. Добро пожаловать!', click: 3,   halo: '#f59e0b' },
      { name: 'Атмосферные зонды',  desc: 'Зонды ныряют в облака и собирают газ.', click: 8,   halo: '#fbbf24', cost: { hydrogen: 600, energy: 200 } },
      { name: 'Парящие станции',    desc: 'Города на аэростатах дрейфуют в облаках.', click: 20,  halo: '#fcd34d', cost: { hydrogen: 5000, energy: 2500, helium: 300 } },
      { name: 'Гелиевые фабрики',   desc: 'Гелий-3 — топливо для звёздных кораблей.', click: 50,  halo: '#c4b5fd', cost: { energy: 25000, helium: 6000, metal: 600 } },
      { name: 'Повелитель бурь',    desc: 'Энергия бурь Юпитера служит всей системе.', click: 130, halo: '#a78bfa', cost: { hydrogen: 400000, helium: 80000, metal: 25000 } }
    ],
    buildings: [
      { id: 'scoop',         tab: 'a', u: 0, name: 'Газозаборник',            icon: '🌫️', desc: 'Черпает водород из облаков.', cost: { hydrogen: 25 }, prod: { hydrogen: 3.5 } },
      { id: 'balloon',       tab: 'a', u: 1, name: 'Аэростат',                icon: '🛸', desc: 'Парит в верхних слоях.', cost: { hydrogen: 250, energy: 60 }, prod: { hydrogen: 12, helium: 0.4 } },
      { id: 'helium_filter', tab: 'a', u: 2, name: 'Гелиевый фильтр',         icon: '⚗️', desc: 'Выделяет драгоценный гелий-3.', cost: { hydrogen: 3500, energy: 1200 }, prod: { helium: 6 } },
      { id: 'storm_rod',     tab: 'b', u: 0, name: 'Громоотвод бурь',         icon: '🔋', desc: 'Ловит молнии размером с Землю.', cost: { hydrogen: 60 }, prod: { energy: 2 } },
      { id: 'red_spot',      tab: 'b', u: 2, name: 'Станция Красного Пятна',  icon: '🌀', desc: 'Энергия вечного урагана.', cost: { hydrogen: 7000, energy: 3000 }, prod: { energy: 50 } },
      { id: 'magneto',       tab: 'b', u: 2, name: 'Магнитосферный генератор', icon: '📡', desc: 'Самая мощная магнитосфера системы.', cost: { energy: 8000, helium: 1500 }, prod: { energy: 120, metal: 4 } },
      { id: 'io_mine',       tab: 'c', u: 3, name: 'Рудники Ио',              icon: '🌕', desc: 'Вулканический спутник полон металлов.', cost: { energy: 35000, helium: 9000 }, prod: { metal: 25 } },
      { id: 'europa',        tab: 'c', u: 3, name: 'База на Европе',          icon: '🌑', desc: 'Под ледяной коркой — океан.', cost: { hydrogen: 60000, metal: 1500 }, prod: { hydrogen: 500, helium: 70 } },
      { id: 'energy_ring',   tab: 'c', u: 4, name: 'Энергетическое кольцо',   icon: '💫', desc: 'Кольцо станций вокруг гиганта.', cost: { helium: 120000, metal: 60000 }, prod: { energy: 4000, helium: 600, metal: 150 } }
    ],
    perks: [
      { id: 'fusion',     name: 'Термоядерный синтез', icon: '☢️', type: 'prod',  step: 0.25, max: 5, base: 3, scale: 1.8, desc: 'Постройки Юпитера производят больше.' },
      { id: 'storm_taps', name: 'Тапы-молнии',         icon: '🌩️', type: 'click', step: 0.5,  max: 5, base: 3, scale: 1.8, desc: 'Тапы по Юпитеру сильнее.' },
      { id: 'shipyards',  name: 'Орбитальные верфи',   icon: '🛰️', type: 'cheap', step: 0.08, max: 5, base: 3, scale: 1.8, desc: 'Постройки и этапы Юпитера дешевле.' }
    ]
  }
};
const PLANET_ORDER = ['earth', 'mars', 'jupiter'];

// Общие перки (Древо Вечности)
const GLOBAL_PERKS = [
  { id: 'autoclicker',  name: 'Автокликер и ПВО',      icon: '🤖', max: 10, base: 1, scale: 1.6, desc: 'Спутник тапает по планете и сбивает астероиды.', effect: (l) => `Выстрелов: ${l * 2}/сек.` },
  { id: 'time_warp',    name: 'Искажение времени',     icon: '⏳', max: 5,  base: 1, scale: 2.0, desc: 'Ускоряет производство на всех планетах.',      effect: (l) => `Скорость: +${l * 25}%` },
  { id: 'cheap_build',  name: 'Квантовая архитектура', icon: '📐', max: 5,  base: 1, scale: 1.8, desc: 'Всё строится дешевле на всех планетах.',     effect: (l) => `Скидка: −${l * 10}%` },
  { id: 'starter_pack', name: 'Ковчег предтеч',        icon: '📦', max: 5,  base: 1, scale: 1.8, desc: 'Запас ресурсов после перерождения.',         effect: (l) => `Старт: +${l * 300} ресурсов` },
  { id: 'crit_solar',   name: 'Сверхзаряд',            icon: '💥', max: 5,  base: 2, scale: 2.0, desc: '15% шанс критического тапа и удара.',        effect: (l) => l > 0 ? `Шанс 15%, урон ×${2 + l}` : 'Откроет криты (шанс 15%)' }
];

// Косметика. cost: 'gems' или 'планета:ресурс'. planet — откуда предмет (нужна открытая планета).
const COSMETICS = [
  // Шапки
  { id: 'hat_crown',   type: 'hat', name: 'Корона Императора',   icon: '👑', desc: 'Золотая корона с рубинами.', cost: { gems: 1 } },
  { id: 'hat_party',   type: 'hat', name: 'Праздничный колпак',  icon: '🥳', desc: 'Полосатый колпак с помпоном.', cost: { gems: 1 } },
  { id: 'hat_tophat',  type: 'hat', name: 'Цилиндр Джентльмена', icon: '🎩', desc: 'Чёрный цилиндр с лентой.', cost: { 'earth:solar': 2500 } },
  { id: 'hat_wizard',  type: 'hat', name: 'Шляпа Архимага',      icon: '🧙', desc: 'Звёздный колпак мага.', cost: { gems: 2 } },
  { id: 'hat_ufo',     type: 'hat', name: 'Пришелец в НЛО',      icon: '🛸', desc: 'Летающая тарелка с огоньками.', cost: { gems: 3 } },
  { id: 'hat_halo',    type: 'hat', name: 'Божественный нимб',   icon: '😇', desc: 'Сияющее золотое кольцо.', cost: { gems: 5 } },
  { id: 'hat_helmet',  type: 'hat', name: 'Шлем космонавта',     icon: '⛑️', desc: 'Стеклянный шлем с антенной.', cost: { 'mars:iron': 6000 }, planet: 'mars' },
  { id: 'hat_rings',   type: 'hat', name: 'Кольца гиганта',      icon: '🪐', desc: 'Сияющие кольца, как у Сатурна.', cost: { 'jupiter:helium': 15000 }, planet: 'jupiter' },
  // Фоны
  { id: 'bg-nebula',      type: 'bg', name: 'Туманность',          icon: '🌌', desc: 'Фиолетовый космос.', cost: { 'earth:solar': 1500 }, swatch: 'radial-gradient(circle at 50% 30%, #6d28d9, #1a0535 70%)' },
  { id: 'bg-deep',        type: 'bg', name: 'Глубокий космос',     icon: '🌑', desc: 'Чёрная бездна и далёкие звёзды.', cost: { gems: 1 }, swatch: 'radial-gradient(circle at 50% 30%, #1e1b3a, #000 70%)' },
  { id: 'bg-emerald',     type: 'bg', name: 'Изумруд',             icon: '💚', desc: 'Зелёный квазар.', cost: { gems: 1 }, swatch: 'radial-gradient(circle at 50% 30%, #059669, #032a22 70%)' },
  { id: 'bg-supernova',   type: 'bg', name: 'Сверхновая',          icon: '🔥', desc: 'Багровое небо звезды.', cost: { gems: 2 }, swatch: 'radial-gradient(circle at 50% 30%, #c2410c, #3a1205 70%)' },
  { id: 'bg-cyber',       type: 'bg', name: 'Кибернетика',         icon: '👾', desc: 'Тёмно-синяя матрица.', cost: { gems: 3 }, swatch: 'linear-gradient(160deg, #020617, #312e81 50%, #020617)' },
  { id: 'bg-mars-sunset', type: 'bg', name: 'Марсианский закат',   icon: '🌅', desc: 'На Марсе закаты голубые!', cost: { 'mars:oxygen': 8000 }, planet: 'mars', swatch: 'linear-gradient(180deg, #1e3a5f, #7c2d12 70%)' },
  { id: 'bg-aurora',      type: 'bg', name: 'Полярное сияние',     icon: '🌠', desc: 'Сияние над полюсами Юпитера.', cost: { 'jupiter:energy': 40000 }, planet: 'jupiter', swatch: 'linear-gradient(160deg, #065f46, #6d28d9 55%, #0b1026)' }
];

// Для Node (симуляция баланса и тесты)
if (typeof module !== 'undefined') module.exports = { GAME_VERSION, RES, PLANETS, PLANET_ORDER, GLOBAL_PERKS, COSMETICS };
