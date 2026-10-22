// Terra 3D — игровые данные: ресурсы, планеты, эпохи, постройки, перки, косметика.
// Числа баланса подобраны симуляцией (см. tools/ в истории разработки).
'use strict';

const GAME_VERSION = 6; // формат сохранения (5 — престиж у каждой планеты, 6 — Венера и Меркурий)

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
  // Венера
  cloud:    { name: 'Облака',    icon: '☁️', tint: 'rgba(253,230,138,0.2)' },
  heat:     { name: 'Жар',       icon: '🔥', tint: 'rgba(249,115,22,0.22)' },
  sulfur:   { name: 'Сера',      icon: '🧪', tint: 'rgba(190,242,100,0.2)' },
  carbon:   { name: 'Углерод',   icon: '🪨', tint: 'rgba(120,113,108,0.25)' },
  // Меркурий
  ore:      { name: 'Руда',      icon: '⛰️', tint: 'rgba(168,162,158,0.22)' },
  plasma:   { name: 'Плазма',    icon: '🔆', tint: 'rgba(253,224,71,0.22)' },
  silicon:  { name: 'Кремний',   icon: '💽', tint: 'rgba(94,234,212,0.2)' },
  alloy:    { name: 'Сплавы',    icon: '🔩', tint: 'rgba(148,163,184,0.25)' },
  // общие валюты
  gems:     { name: 'Кристаллы', icon: '💎', tint: 'rgba(192,132,252,0.25)' },
  sapphire: { name: 'Сапфиры',   icon: '🔷', tint: 'rgba(59,130,246,0.25)' }
};

// u — эпоха (этап), с которой постройка открывается; tab — цвет плитки (a/b/c), все постройки в одной вкладке
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
      { name: 'Звёздная империя',    desc: 'Рой Дайсона питает цивилизацию, покоряющую систему.', click: 1200, halo: '#c084fc', cost: { solar: 1800000, water: 600000, science: 80000 } },
      { name: 'Орбитальные кольца',  desc: 'Города на кольце вокруг планеты, лифты до самой орбиты.', click: 2600, halo: '#38bdf8', cost: { solar: 12e6, air: 4e6, science: 5e5 } },
      { name: 'Планетарный разум',   desc: 'Сеть ИИ бережно управляет климатом, океанами и лесами.', click: 5600, halo: '#22d3ee', cost: { solar: 8e7, water: 3e7, science: 3e6 } },
      { name: 'Звёздные врата',      desc: 'Кольцо-портал на орбите открывает путь к другим звёздам.', click: 12000, halo: '#a78bfa', cost: { solar: 6e8, air: 2.5e8, science: 6e7 } },
      { name: 'Межзвёздная держава', desc: 'Колонии Земли сияют в соседних звёздных системах.', click: 26000, halo: '#f472b6', cost: { solar: 2e10, biomass: 2e9, science: 2e9 } },
      { name: 'Галактический маяк',  desc: 'Свет Земли виден с другого края галактики.', click: 56000, halo: '#fde68a', cost: { solar: 1.5e11, water: 5e10, science: 1.5e10 } }
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
      { id: 'dyson_swarm',     tab: 'c', u: 9, name: 'Рой Дайсона',         icon: '🌞', desc: 'Мегаструктура вокруг Солнца.', cost: { solar: 15000000, science: 800000 }, prod: { solar: 250000, water: 60000, air: 60000, science: 20000 } },
      { id: 'weather_net',     tab: 'a', u: 10, name: 'Погодная сеть',      icon: '⛈️', desc: 'Спутники управляют дождями и ветрами.', cost: { air: 2e7, water: 2e7 }, prod: { air: 7e5, water: 6e5 } },
      { id: 'orbital_ring',    tab: 'c', u: 10, name: 'Орбитальное кольцо', icon: '⭕', desc: 'Город длиной в экватор.', cost: { solar: 6e7, science: 2.5e6 }, prod: { solar: 1.4e6, science: 6e4 } },
      { id: 'gaia_ai',         tab: 'b', u: 11, name: 'Разум Геи',          icon: '🧠', desc: 'ИИ, который заботится о биосфере.', cost: { air: 4e7, science: 1.2e7 }, prod: { biomass: 1e6, air: 7e5, water: 7e5, science: 1.8e5 } },
      { id: 'fusion_ocean',    tab: 'a', u: 12, name: 'Термоядерные моря',  icon: '♨️', desc: 'Океаны дают энергию синтеза.', cost: { water: 3e8, solar: 3e8 }, prod: { water: 9e6, solar: 7e6, air: 2.5e6 } },
      { id: 'ark_gardens',     tab: 'b', u: 12, name: 'Сады-ковчеги',       icon: '🌴', desc: 'Парящие сады со всей жизнью Земли.', cost: { water: 1.5e8, air: 1e8 }, prod: { biomass: 6e6, air: 3.5e6 } },
      { id: 'stargate',        tab: 'c', u: 13, name: 'Звёздные врата',     icon: '⛩️', desc: 'Портал к другим звёздам.', cost: { solar: 5e10, science: 4e9 }, prod: { science: 6e7, solar: 6e8, water: 2e8 } },
      { id: 'beacon',          tab: 'c', u: 14, name: 'Галактический маяк', icon: '🗼', desc: 'Луч, видимый всей галактике.', cost: { solar: 6e11, science: 6e10 }, prod: { solar: 6e9, water: 1.5e9, air: 1.5e9, biomass: 6e8, science: 6e8 } }
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
      { name: 'Зелёный Марс',        desc: 'Атмосфера, моря и голубое небо. Марс ожил!', click: 80, halo: '#5eead4', cost: { regolith: 120000, iron: 50000, oxygen: 40000 } },
      { name: 'Марсианские леса',    desc: 'Сосны и мхи покрыли равнины, реки потекли снова.', click: 200, halo: '#4ade80', cost: { ice: 8e5, oxygen: 6e5, regolith: 2e5 } },
      { name: 'Столица на Олимпе',   desc: 'На склонах величайшего вулкана вырос мегаполис.', click: 480, halo: '#facc15', cost: { oxygen: 2e7, ice: 1e7, iron: 4e5 } },
      { name: 'Космический лифт',    desc: 'Трос до орбиты: грузы летят в космос почти даром.', click: 1100, halo: '#94a3b8', cost: { oxygen: 1.2e8, ice: 8e7, regolith: 3e7 } },
      { name: 'Кольцо Фобоса',       desc: 'Спутник превратили в сияющее кольцо станций.', click: 2600, halo: '#c084fc', cost: { regolith: 1.5e9, iron: 8e8, oxygen: 6e8 } },
      { name: 'Второй дом',          desc: 'Марс стал цветущим миром — вторым домом людей.', click: 6000, halo: '#2dd4bf', cost: { regolith: 2e10, ice: 8e9, oxygen: 8e9 } }
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
      { id: 'mars_seas',  tab: 'c', u: 4, name: 'Марсианские моря', icon: '🌊', desc: 'Растопленные полюса стали морями.', cost: { ice: 200000, oxygen: 80000 }, prod: { ice: 1500, oxygen: 900 } },
      { id: 'mars_forest', tab: 'c', u: 5, name: 'Марсианский лес',  icon: '🌳', desc: 'Леса дышат кислородом.', cost: { ice: 1.5e6, regolith: 3e5 }, prod: { oxygen: 9000, ice: 5000, regolith: 1500 } },
      { id: 'olympus',     tab: 'b', u: 6, name: 'Город на Олимпе',  icon: '🏔️', desc: 'Столица на вершине вулкана.', cost: { oxygen: 1e7, ice: 5e6 }, prod: { regolith: 8e4, iron: 3e4 } },
      { id: 'elevator',    tab: 'a', u: 7, name: 'Космический лифт', icon: '🚡', desc: 'Кабины скользят по тросу до орбиты.', cost: { regolith: 8e7, ice: 4e7 }, prod: { iron: 3.5e5, oxygen: 3e5, regolith: 2e5 } },
      { id: 'phobos_ring', tab: 'c', u: 8, name: 'Кольцо Фобоса',    icon: '💍', desc: 'Станции на обломках спутника.', cost: { iron: 6e8, oxygen: 2e8 }, prod: { regolith: 3e6, ice: 3e6, oxygen: 3e6, iron: 1e6 } },
      { id: 'mars_home',   tab: 'b', u: 9, name: 'Второй дом',       icon: '🏡', desc: 'Миллиарды жителей нового мира.', cost: { regolith: 6e9, iron: 3e9 }, prod: { regolith: 2.5e7, oxygen: 3e7, ice: 3e7, iron: 1e7 } }
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
      { name: 'Повелитель бурь',    desc: 'Энергия бурь Юпитера служит всей системе.', click: 130, halo: '#a78bfa', cost: { hydrogen: 400000, helium: 80000, metal: 25000 } },
      { name: 'Заводы на лунах',    desc: 'Ио, Европа и Каллисто превратились в заводы.', click: 330, halo: '#fb923c', cost: { hydrogen: 1.5e6, energy: 2e6, metal: 3e5 } },
      { name: 'Облачные города',    desc: 'Огни парящих городов мерцают в вечных бурях.', click: 780, halo: '#fde047', cost: { hydrogen: 1.5e7, helium: 1e7, energy: 2e7 } },
      { name: 'Гравитационная праща', desc: 'Юпитер разгоняет корабли к краю системы.', click: 1800, halo: '#60a5fa', cost: { energy: 1.2e8, helium: 6e7, metal: 3e7 } },
      { name: 'Зажжённое ядро',     desc: 'В недрах гиганта зажгли термоядерное пламя.', click: 4200, halo: '#f97316', cost: { hydrogen: 2e9, energy: 6e8, metal: 2e8 } },
      { name: 'Второе Солнце',      desc: 'Юпитер вспыхнул звездой — в системе два солнца!', click: 10000, halo: '#fef08a', cost: { hydrogen: 6e9, helium: 1.5e9, metal: 8e8 } }
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
      { id: 'energy_ring',   tab: 'c', u: 4, name: 'Энергетическое кольцо',   icon: '💫', desc: 'Кольцо станций вокруг гиганта.', cost: { helium: 120000, metal: 60000 }, prod: { energy: 4000, helium: 600, metal: 150 } },
      { id: 'moon_forge',    tab: 'c', u: 5, name: 'Лунные заводы',           icon: '🛠️', desc: 'Плавильни на вулканах Ио.', cost: { energy: 4e6, metal: 6e5 }, prod: { hydrogen: 6000, metal: 3500, helium: 2500 } },
      { id: 'cloud_city',    tab: 'a', u: 6, name: 'Облачный город',          icon: '☁️', desc: 'Мегаполис на воздушных шарах.', cost: { helium: 1.5e7, energy: 1e7 }, prod: { hydrogen: 4.5e5, helium: 7e4 } },
      { id: 'sling',         tab: 'b', u: 7, name: 'Гравитационная праща',    icon: '🎯', desc: 'Разгоняет корабли гравитацией.', cost: { hydrogen: 3e8, helium: 5e7 }, prod: { energy: 2.5e6, metal: 3e5, hydrogen: 1e6 } },
      { id: 'core_igniter',  tab: 'b', u: 8, name: 'Зажигатель ядра',         icon: '💥', desc: 'Термоядерное пламя в недрах.', cost: { energy: 2e9, metal: 3e8 }, prod: { energy: 1.6e7, hydrogen: 1.2e7 } },
      { id: 'second_sun',    tab: 'c', u: 9, name: 'Второе Солнце',           icon: '🌟', desc: 'Юпитер светит, как звезда.', cost: { energy: 2e10, helium: 5e9 }, prod: { hydrogen: 1.2e8, energy: 1.2e8, helium: 2.5e7, metal: 2e7 } }
    ],
    perks: [
      { id: 'fusion',     name: 'Термоядерный синтез', icon: '☢️', type: 'prod',  step: 0.25, max: 5, base: 3, scale: 1.8, desc: 'Постройки Юпитера производят больше.' },
      { id: 'storm_taps', name: 'Тапы-молнии',         icon: '🌩️', type: 'click', step: 0.5,  max: 5, base: 3, scale: 1.8, desc: 'Тапы по Юпитеру сильнее.' },
      { id: 'shipyards',  name: 'Орбитальные верфи',   icon: '🛰️', type: 'cheap', step: 0.08, max: 5, base: 3, scale: 1.8, desc: 'Постройки и этапы Юпитера дешевле.' }
    ]
  },
  venus: {
    name: 'Венера', icon: '🟡', stageWord: 'Этап', clickRes: 'cloud',
    res: ['cloud', 'heat', 'sulfur', 'carbon'],
    start: { cloud: 60 },
    defaultBg: 'bg-venus',
    unlock: { earthEra: 10, stages: { jupiter: 3 }, cost: { 'earth:solar': 2e7, 'jupiter:hydrogen': 2e5 } },
    tabs: [
      { id: 'a', icon: '☁️', label: 'Облака' },
      { id: 'b', icon: '🔥', label: 'Жар' },
      { id: 'c', icon: '🌺', label: 'Терраформ' }
    ],
    eras: [
      { name: 'Адский шар',         desc: 'Кислотные облака, давление в 90 атмосфер и жар +460°. Добро пожаловать!', click: 3,   halo: '#facc15' },
      { name: 'Облачные зонды',     desc: 'Зонды парят в облаках и собирают газ.', click: 8,   halo: '#fde047', cost: { cloud: 600, heat: 200 } },
      { name: 'Парящие колонии',    desc: 'На высоте 50 км почти земное давление — там вырос первый город.', click: 20,  halo: '#fbbf24', cost: { cloud: 5000, heat: 2500, sulfur: 300 } },
      { name: 'Кислотные фабрики',  desc: 'Серу из облаков превращают в топливо и стройматериалы.', click: 50,  halo: '#a3e635', cost: { heat: 25000, sulfur: 6000, carbon: 600 } },
      { name: 'Солнечный зонтик',   desc: 'Гигантский экран в космосе начал остужать планету.', click: 130, halo: '#fef08a', cost: { cloud: 400000, sulfur: 80000, carbon: 25000 } },
      { name: 'Углеродные шахты',   desc: 'Плотную атмосферу перерабатывают в алмазы и графен.', click: 330, halo: '#d6d3d1', cost: { cloud: 1.5e6, heat: 2e6, carbon: 3e5 } },
      { name: 'Первые дожди',       desc: 'Остывшее небо пролилось дождями — впервые за миллиард лет.', click: 780, halo: '#7dd3fc', cost: { cloud: 1.5e7, sulfur: 1e7, heat: 2e7 } },
      { name: 'Моря Венеры',        desc: 'В низинах разлились тёплые моря.', click: 1800, halo: '#22d3ee', cost: { heat: 1.2e8, sulfur: 6e7, carbon: 3e7 } },
      { name: 'Сады Венеры',        desc: 'Зелёные равнины под мягким золотым небом.', click: 4200, halo: '#4ade80', cost: { cloud: 2e9, heat: 6e8, carbon: 2e8 } },
      { name: 'Утренняя звезда',    desc: 'Венера стала цветущим садом — самой яркой звездой утра.', click: 10000, halo: '#fde68a', cost: { cloud: 6e9, sulfur: 1.5e9, carbon: 8e8 } }
    ],
    buildings: [
      { id: 'cloud_net',     tab: 'a', u: 0, name: 'Облачные сети',          icon: '🕸️', desc: 'Ловят капли облаков на высоте.', cost: { cloud: 25 }, prod: { cloud: 3.5 } },
      { id: 'heat_pipe',     tab: 'b', u: 0, name: 'Тепловая труба',          icon: '🌡️', desc: 'Забирает жар раскалённой поверхности.', cost: { cloud: 60 }, prod: { heat: 2 } },
      { id: 'aerostat',      tab: 'a', u: 1, name: 'Аэростат-станция',        icon: '🎈', desc: 'Дрейфует в тёплом ветре.', cost: { cloud: 250, heat: 60 }, prod: { cloud: 12, sulfur: 0.4 } },
      { id: 'acid_still',    tab: 'a', u: 2, name: 'Кислотный перегонщик',    icon: '⚗️', desc: 'Выделяет серу из облаков.', cost: { cloud: 3500, heat: 1200 }, prod: { sulfur: 6 } },
      { id: 'volcano_tap',   tab: 'b', u: 2, name: 'Вулканическая скважина',  icon: '🌋', desc: 'Энергия вулканов Венеры.', cost: { cloud: 7000, heat: 3000 }, prod: { heat: 50 } },
      { id: 'thermo_gen',    tab: 'b', u: 2, name: 'Термоэлектростанция',     icon: '🔌', desc: 'Перепад температур даёт ток.', cost: { heat: 8000, sulfur: 1500 }, prod: { heat: 120, carbon: 4 } },
      { id: 'carbon_press',  tab: 'c', u: 3, name: 'Углеродный пресс',        icon: '🗜️', desc: 'Сжимает углекислый газ в графит.', cost: { heat: 35000, sulfur: 9000 }, prod: { carbon: 25 } },
      { id: 'floating_city', tab: 'c', u: 3, name: 'Парящий город',           icon: '🌆', desc: 'Город на гигантских аэростатах.', cost: { cloud: 60000, carbon: 1500 }, prod: { cloud: 500, sulfur: 70 } },
      { id: 'sunshade',      tab: 'c', u: 4, name: 'Солнечный зонтик',        icon: '⛱️', desc: 'Тень остужает планету.', cost: { sulfur: 120000, carbon: 60000 }, prod: { heat: 4000, sulfur: 600, carbon: 150 } },
      { id: 'diamond_works', tab: 'c', u: 5, name: 'Алмазный завод',          icon: '🔶', desc: 'Графен и алмазы прямо из атмосферы.', cost: { heat: 4e6, carbon: 6e5 }, prod: { cloud: 6000, carbon: 3500, sulfur: 2500 } },
      { id: 'rain_maker',    tab: 'a', u: 6, name: 'Дождевальные башни',      icon: '🌧️', desc: 'Вызывают первые дожди.', cost: { sulfur: 1.5e7, heat: 1e7 }, prod: { cloud: 4.5e5, sulfur: 7e4 } },
      { id: 'sea_port',      tab: 'b', u: 7, name: 'Морские порты',           icon: '⚓', desc: 'Гавани на тёплых морях.', cost: { cloud: 3e8, sulfur: 5e7 }, prod: { heat: 2.5e6, carbon: 3e5, cloud: 1e6 } },
      { id: 'garden_dome',   tab: 'c', u: 8, name: 'Цветущие равнины',        icon: '🌺', desc: 'Сады под золотым небом.', cost: { heat: 2e9, carbon: 3e8 }, prod: { heat: 1.6e7, cloud: 1.2e7 } },
      { id: 'morning_star',  tab: 'c', u: 9, name: 'Утренняя звезда',         icon: '🌅', desc: 'Сияющий мир на рассвете.', cost: { heat: 2e10, sulfur: 5e9 }, prod: { cloud: 1.2e8, heat: 1.2e8, sulfur: 2.5e7, carbon: 2e7 } }
    ],
    perks: [
      { id: 'acid_shield', name: 'Кислотный щит',   icon: '🛡️', type: 'prod',  step: 0.25, max: 5, base: 4, scale: 1.8, desc: 'Постройки Венеры производят больше.' },
      { id: 'hot_taps',    name: 'Жаркие тапы',     icon: '♨️', type: 'click', step: 0.5,  max: 5, base: 4, scale: 1.8, desc: 'Тапы по Венере сильнее.' },
      { id: 'cloud_docks', name: 'Облачные доки',   icon: '🛠️', type: 'cheap', step: 0.08, max: 5, base: 4, scale: 1.8, desc: 'Постройки и этапы Венеры дешевле.' }
    ]
  },

  mercury: {
    name: 'Меркурий', icon: '🌑', stageWord: 'Этап', clickRes: 'ore',
    res: ['ore', 'plasma', 'silicon', 'alloy'],
    start: { ore: 60 },
    defaultBg: 'bg-mercury',
    unlock: { earthEra: 11, stages: { venus: 3 }, cost: { 'earth:science': 5e6, 'venus:heat': 3e5 } },
    tabs: [
      { id: 'a', icon: '⛰️', label: 'Недра' },
      { id: 'b', icon: '🔆', label: 'Солнце' },
      { id: 'c', icon: '🛤️', label: 'Космос' }
    ],
    eras: [
      { name: 'Раскалённая скала',   desc: 'Днём +430°, ночью −180°. Самая близкая к Солнцу планета.', click: 3,   halo: '#d6d3d1' },
      { name: 'Полярные кратеры',    desc: 'В вечной тени кратеров нашли лёд — высадка!', click: 8,   halo: '#a5f3fc', cost: { ore: 600, plasma: 200 } },
      { name: 'Город-терминатор',    desc: 'Город на рельсах едет вслед за ночью, спасаясь от жара.', click: 20,  halo: '#fcd34d', cost: { ore: 5000, plasma: 2500, silicon: 300 } },
      { name: 'Солнечные фермы',     desc: 'Поля панелей ловят свет в семь раз ярче земного.', click: 50,  halo: '#fde047', cost: { plasma: 25000, silicon: 6000, alloy: 600 } },
      { name: 'Рельсотроны',         desc: 'Магнитные пушки швыряют грузы прямо в космос.', click: 130, halo: '#93c5fd', cost: { ore: 400000, silicon: 80000, alloy: 25000 } },
      { name: 'Кремниевая долина',   desc: 'Заводы микросхем для всей Солнечной системы.', click: 330, halo: '#5eead4', cost: { ore: 1.5e6, plasma: 2e6, alloy: 3e5 } },
      { name: 'Зеркальное кольцо',   desc: 'Кольцо зеркал направляет свет туда, где он нужен.', click: 780, halo: '#e0f2fe', cost: { ore: 1.5e7, silicon: 1e7, plasma: 2e7 } },
      { name: 'Ловушка антиматерии', desc: 'Солнечная плазма рождает антивещество.', click: 1800, halo: '#c084fc', cost: { plasma: 1.2e8, silicon: 6e7, alloy: 3e7 } },
      { name: 'Кузница звёзд',       desc: 'Недра Меркурия переплавляют в детали мегаструктур.', click: 4200, halo: '#fb923c', cost: { ore: 2e9, plasma: 6e8, alloy: 2e8 } },
      { name: 'Сфера Дайсона',       desc: 'Меркурий стал кузницей сферы вокруг Солнца.', click: 10000, halo: '#fef08a', cost: { ore: 6e9, silicon: 1.5e9, alloy: 8e8 } }
    ],
    buildings: [
      { id: 'ore_crawler',    tab: 'a', u: 0, name: 'Рудный краулер',       icon: '🚜', desc: 'Ползёт по раскалённым равнинам.', cost: { ore: 25 }, prod: { ore: 3.5 } },
      { id: 'solar_panel',    tab: 'b', u: 0, name: 'Солнечная панель',     icon: '🔳', desc: 'Свет здесь в семь раз ярче.', cost: { ore: 60 }, prod: { plasma: 2 } },
      { id: 'ice_crater',     tab: 'a', u: 1, name: 'Ледяной кратер',       icon: '🧊', desc: 'Лёд из вечной тени полюсов.', cost: { ore: 250, plasma: 60 }, prod: { ore: 12, silicon: 0.4 } },
      { id: 'sand_smelter',   tab: 'a', u: 2, name: 'Кварцевая плавильня',  icon: '🧱', desc: 'Плавит кварц в кремний.', cost: { ore: 3500, plasma: 1200 }, prod: { silicon: 6 } },
      { id: 'plasma_tower',   tab: 'b', u: 2, name: 'Плазменная башня',     icon: '💡', desc: 'Собирает солнечный ветер.', cost: { ore: 7000, plasma: 3000 }, prod: { plasma: 50 } },
      { id: 'mag_store',      tab: 'b', u: 2, name: 'Магнитный накопитель', icon: '🎛️', desc: 'Хранит энергию в магнитном поле.', cost: { plasma: 8000, silicon: 1500 }, prod: { plasma: 120, alloy: 4 } },
      { id: 'alloy_forge',    tab: 'c', u: 3, name: 'Сплавная кузня',       icon: '⚒️', desc: 'Тугоплавкие сплавы для кораблей.', cost: { plasma: 35000, silicon: 9000 }, prod: { alloy: 25 } },
      { id: 'rail_city',      tab: 'c', u: 3, name: 'Город на рельсах',     icon: '🚂', desc: 'Едет за ночью вокруг планеты.', cost: { ore: 60000, alloy: 1500 }, prod: { ore: 500, silicon: 70 } },
      { id: 'railgun',        tab: 'c', u: 4, name: 'Рельсотрон',           icon: '🛤️', desc: 'Магнитная пушка для грузов.', cost: { silicon: 120000, alloy: 60000 }, prod: { plasma: 4000, silicon: 600, alloy: 150 } },
      { id: 'chip_fab',       tab: 'c', u: 5, name: 'Фабрика микросхем',    icon: '💾', desc: 'Кремний для всей системы.', cost: { plasma: 4e6, alloy: 6e5 }, prod: { ore: 6000, alloy: 3500, silicon: 2500 } },
      { id: 'mirror_ring',    tab: 'b', u: 6, name: 'Зеркальное кольцо',    icon: '🪞', desc: 'Зеркала ловят свет Солнца.', cost: { silicon: 1.5e7, plasma: 1e7 }, prod: { ore: 4.5e5, silicon: 7e4 } },
      { id: 'antimatter_trap', tab: 'b', u: 7, name: 'Ловушка антиматерии', icon: '⚛️', desc: 'Магнитные бутылки с антивеществом.', cost: { ore: 3e8, silicon: 5e7 }, prod: { plasma: 2.5e6, alloy: 3e5, ore: 1e6 } },
      { id: 'star_forge',     tab: 'a', u: 8, name: 'Кузница звёзд',        icon: '🔨', desc: 'Переплавляет недра в мегаструктуры.', cost: { plasma: 2e9, alloy: 3e8 }, prod: { plasma: 1.6e7, ore: 1.2e7 } },
      { id: 'dyson_sphere',   tab: 'c', u: 9, name: 'Сфера Дайсона',        icon: '✴️', desc: 'Оболочка вокруг Солнца.', cost: { plasma: 2e10, silicon: 5e9 }, prod: { ore: 1.2e8, plasma: 1.2e8, silicon: 2.5e7, alloy: 2e7 } }
    ],
    perks: [
      { id: 'heat_sinks',   name: 'Теплоотводы',       icon: '🧊', type: 'prod',  step: 0.25, max: 5, base: 5, scale: 1.8, desc: 'Постройки Меркурия производят больше.' },
      { id: 'iron_fist',    name: 'Железный кулак',    icon: '👊', type: 'click', step: 0.5,  max: 5, base: 5, scale: 1.8, desc: 'Тапы по Меркурию сильнее.' },
      { id: 'mass_drivers', name: 'Масс-драйверы',     icon: '🧲', type: 'cheap', step: 0.08, max: 5, base: 5, scale: 1.8, desc: 'Постройки и этапы Меркурия дешевле.' }
    ]
  }
};
const PLANET_ORDER = ['earth', 'mars', 'jupiter', 'venus', 'mercury'];

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
  { id: 'hat_flowers', type: 'hat', name: 'Венок Венеры',        icon: '🌸', desc: 'Цветы из садов Утренней звезды.', cost: { 'venus:sulfur': 15000 }, planet: 'venus' },
  { id: 'hat_shades',  type: 'hat', name: 'Солнечные очки',      icon: '🕶️', desc: 'Без них у Солнца не обойтись.', cost: { 'mercury:silicon': 15000 }, planet: 'mercury' },
  // Фоны
  { id: 'bg-nebula',      type: 'bg', name: 'Туманность',          icon: '🌌', desc: 'Фиолетовый космос.', cost: { 'earth:solar': 1500 }, swatch: 'radial-gradient(circle at 50% 30%, #6d28d9, #1a0535 70%)' },
  { id: 'bg-deep',        type: 'bg', name: 'Глубокий космос',     icon: '🌑', desc: 'Чёрная бездна и далёкие звёзды.', cost: { gems: 1 }, swatch: 'radial-gradient(circle at 50% 30%, #1e1b3a, #000 70%)' },
  { id: 'bg-emerald',     type: 'bg', name: 'Изумруд',             icon: '💚', desc: 'Зелёный квазар.', cost: { gems: 1 }, swatch: 'radial-gradient(circle at 50% 30%, #059669, #032a22 70%)' },
  { id: 'bg-supernova',   type: 'bg', name: 'Сверхновая',          icon: '🔥', desc: 'Багровое небо звезды.', cost: { gems: 2 }, swatch: 'radial-gradient(circle at 50% 30%, #c2410c, #3a1205 70%)' },
  { id: 'bg-cyber',       type: 'bg', name: 'Кибернетика',         icon: '👾', desc: 'Тёмно-синяя матрица.', cost: { gems: 3 }, swatch: 'linear-gradient(160deg, #020617, #312e81 50%, #020617)' },
  { id: 'bg-mars-sunset', type: 'bg', name: 'Марсианский закат',   icon: '🌅', desc: 'На Марсе закаты голубые!', cost: { 'mars:oxygen': 8000 }, planet: 'mars', swatch: 'linear-gradient(180deg, #1e3a5f, #7c2d12 70%)' },
  { id: 'bg-aurora',      type: 'bg', name: 'Полярное сияние',     icon: '🌠', desc: 'Сияние над полюсами Юпитера.', cost: { 'jupiter:energy': 40000 }, planet: 'jupiter', swatch: 'linear-gradient(160deg, #065f46, #6d28d9 55%, #0b1026)' },
  { id: 'bg-dawn',        type: 'bg', name: 'Утренняя заря',       icon: '🌄', desc: 'Розово-золотое небо Венеры.', cost: { 'venus:heat': 40000 }, planet: 'venus', swatch: 'linear-gradient(180deg, #1e1b4b, #9d174d 55%, #f59e0b)' },
  { id: 'bg-corona',      type: 'bg', name: 'Солнечная корона',    icon: '☀️', desc: 'Огромное Солнце за Меркурием.', cost: { 'mercury:plasma': 40000 }, planet: 'mercury', swatch: 'radial-gradient(circle at 50% 110%, #fef08a 0 18%, #f97316 32%, #7c2d12 52%, #0c0a09 75%)' },
  // Только по промокоду (code: true — не продаются)
  { id: 'bg-founder',     type: 'bg', name: 'Первопроходец',       icon: '🌟', desc: 'Золотая пыль первых звёзд.', code: true, swatch: 'radial-gradient(circle at 50% 30%, #a16207, #1c1203 70%)' },
  { id: 'bg-community',   type: 'bg', name: 'Сообщество',          icon: '💬', desc: 'Для своих — из пака сообщества.', code: true, swatch: 'linear-gradient(160deg, #312e81, #6d28d9 50%, #0b1026)' },
  { id: 'bg-admin',       type: 'bg', name: 'Командный центр',     icon: '🛡️', desc: 'Цвета администрации игры.', code: true, swatch: 'linear-gradient(160deg, #450a0a, #0f172a 55%, #b91c1c)' },
  // Только из сундуков (chest: true)
  { id: 'hat_star',       type: 'hat', name: 'Путеводная звезда',  icon: '⭐', desc: 'Сияющая звезда над планетой.', chest: true },
  { id: 'hat_comet',      type: 'hat', name: 'Хвост кометы',       icon: '☄️', desc: 'Огненный хвост, будто планета летит.', chest: true },
  { id: 'bg-galaxy',      type: 'bg',  name: 'Спиральная галактика', icon: '🌀', desc: 'Рукава галактики за планетой.', chest: true, swatch: 'radial-gradient(circle at 50% 45%, #fde68a 0 4%, #7c3aed 18%, #1e1b4b 45%, #020617 70%)' },
  { id: 'bg-blackhole',   type: 'bg',  name: 'Чёрная дыра',        icon: '🕳️', desc: 'Огненный диск вокруг бездны.', chest: true, swatch: 'radial-gradient(circle at 50% 50%, #000 0 14%, #f97316 17%, #7c2d12 26%, #0c0a09 55%)' },
  { id: 'bg-rainbow',     type: 'bg',  name: 'Радужная туманность', icon: '🌈', desc: 'Все цвета космоса сразу.', chest: true, swatch: 'linear-gradient(135deg, #be185d, #7c3aed 30%, #0ea5e9 60%, #10b981 85%)' }
];

// ===== Престиж планеты =====
// У каждой планеты свои престижи. n — сколько престижей уже сделано на этой планете.
// Цели растут: этап выше на 1 за каждый престиж, построек больше (но не больше buildCap), а когда этапы
// кончились — копить ресурс тапа. Рост мягкий (степень 1.75), чтобы и на 200+ престиже цели были посильными:
// доход планеты растёт вместе с престижем (×(1+n)).
const PRESTIGE = {
  earth:   { baseStage: 4, buildBase: 30, buildStep: 22, buildSq: 3, buildCap: 1100, gems: 0 },
  mars:    { baseStage: 3, buildBase: 25, buildStep: 18, buildSq: 3, buildCap: 650,  gems: 2 },
  jupiter: { baseStage: 3, buildBase: 25, buildStep: 18, buildSq: 3, buildCap: 650,  gems: 4 },
  venus:   { baseStage: 3, buildBase: 25, buildStep: 18, buildSq: 3, buildCap: 650,  gems: 6 },
  mercury: { baseStage: 3, buildBase: 25, buildStep: 18, buildSq: 3, buildCap: 650,  gems: 8 }
};
function prestigeGoals(pid, n) {
  const P = PLANETS[pid], C = PRESTIGE[pid], max = P.eras.length - 1;
  const goals = [];
  const want = C.baseStage + n;
  goals.push({ kind: 'stage', need: Math.min(max, want) });
  goals.push({ kind: 'build', need: Math.min(C.buildCap, C.buildBase + C.buildStep * n + C.buildSq * n * n) });
  if (want > max) {
    // этапы кончились — копим ресурс тапа; цель растёт плавно (степень 1.75, а не ×4 за каждый престиж, как раньше)
    const base = P.eras[max].cost[P.clickRes] || Object.values(P.eras[max].cost)[0];
    goals.push({ kind: 'res', res: P.clickRes, need: Math.round(base * 2 * Math.pow(want - max, 1.75)) });
  }
  return goals;
}
// Награда кристаллами за престиж
function prestigeGems(pid, n, stage) { return 2 + Math.floor(stage / 2) + Math.floor(n * 0.75) + PRESTIGE[pid].gems; }

// Количество за одну покупку построек
const BUY_MODES = [1, 10, 50, 100, 'max'];
const BUILD_GROWTH = 1.18;   // каждая следующая постройка дороже на 18%

// ===== Сундуки (магазин за сапфиры) =====
// Ресурсы в сундуке — это доход текущей планеты за boostMin минут (так награда растёт вместе с игроком)
const CHESTS = [
  { id: 'small',  name: 'Малый сундук',        icon: '🎁', price: 5,  color: '#38bdf8', desc: 'Кристаллы и ресурсы. Иногда — ускоритель.',
    gems: [2, 5], resMin: 10, boostChance: 0.25, boostMin: 10, itemChance: 0.08 },
  { id: 'big',    name: 'Большой сундук',      icon: '🧰', price: 15, color: '#a78bfa', desc: 'Много кристаллов, ресурсы, ускоритель, шанс на редкий образ.',
    gems: [7, 14], resMin: 30, boostChance: 0.6, boostMin: 20, itemChance: 0.3 },
  { id: 'legend', name: 'Легендарный сундук',  icon: '👑', price: 40, color: '#fbbf24', desc: 'Гарантированный редкий образ, кристаллы и ускоритель на час.',
    gems: [18, 32], resMin: 60, boostChance: 1, boostMin: 60, itemChance: 1 }
];

// ===== Квесты =====
// Ежедневные: каждый день выбираются 3 задания. stat — счётчик из статистики игрока, прирост за день.
const DAILY_QUESTS = [
  { id: 'd_taps',    icon: '👆', text: 'Сделайте {n} тапов по планете',  stat: 'taps',      n: 300, reward: 1 },
  { id: 'd_build',   icon: '🏗️', text: 'Постройте {n} зданий',           stat: 'built',     n: 30,  reward: 1 },
  { id: 'd_ast',     icon: '☄️', text: 'Сбейте {n} астероида',          stat: 'asteroids', n: 2,   reward: 2 },
  { id: 'd_evolve',  icon: '⏫', text: 'Проведите эволюцию планеты',      stat: 'evolves',   n: 1,   reward: 1, need: 'evolve' },
  { id: 'd_time',    icon: '⏱️', text: 'Играйте {n} минут',               stat: 'minutes',   n: 10,  reward: 1 },
  { id: 'd_perk',    icon: '🌳', text: 'Улучшите любой перк',             stat: 'perks',     n: 1,   reward: 1, need: 'gems' },
  { id: 'd_travel',  icon: '🚀', text: 'Слетайте на другую планету',      stat: 'travels',   n: 1,   reward: 1, need: 'planets' },
  { id: 'd_build2',  icon: '🏙️', text: 'Постройте {n} зданий',           stat: 'built',     n: 120, reward: 2 }
];
const DAILY_COUNT = 3;
const DAILY_BONUS = 2;     // за все задания дня

// Достижения: разовые. kind: stat — счётчик; era — лучшая эпоха/этап планеты; rebirths; planet — открыта ли; style — косметика
const ACHIEVEMENTS = [
  { id: 'a_build1',  icon: '🏗️', name: 'Первый камень',       desc: 'Постройте любое здание',           kind: 'stat', key: 'built',     goal: 1,    reward: 1 },
  { id: 'a_era3',    icon: '☁️', name: 'Дыхание планеты',     desc: 'Достигните 3-й эпохи Земли',        kind: 'era',  key: 'earth',     goal: 3,    reward: 1 },
  { id: 'a_era5',    icon: '🌳', name: 'Зелёный мир',          desc: 'Достигните 5-й эпохи Земли',        kind: 'era',  key: 'earth',     goal: 5,    reward: 2 },
  { id: 'a_style',   icon: '🎩', name: 'Модник',               desc: 'Купите шапку или фон',              kind: 'style',                  goal: 1,    reward: 1 },
  { id: 'a_ast10',   icon: '🛡️', name: 'Щит планеты',         desc: 'Сбейте 10 астероидов',             kind: 'stat', key: 'asteroids', goal: 10,   reward: 2 },
  { id: 'a_gold',    icon: '✨', name: 'Золотая лихорадка',    desc: 'Сбейте золотой астероид',          kind: 'stat', key: 'golden',    goal: 1,    reward: 2 },
  { id: 'a_taps',    icon: '👆', name: 'Неутомимый палец',     desc: 'Сделайте 5 000 тапов',              kind: 'stat', key: 'taps',      goal: 5000, reward: 2 },
  { id: 'a_reb1',    icon: '🌀', name: 'Новое начало',         desc: 'Совершите первый престиж',          kind: 'rebirths',               goal: 1,    reward: 3 },
  { id: 'a_build500',icon: '🏘️', name: 'Архитектор',          desc: 'Постройте 500 зданий',              kind: 'stat', key: 'built',     goal: 500,  reward: 2 },
  { id: 'a_era10',   icon: '🌞', name: 'Звёздная империя',     desc: 'Достигните 10-й эпохи Земли',       kind: 'era',  key: 'earth',     goal: 10,   reward: 5 },
  { id: 'a_mars',    icon: '🔴', name: 'Первые на Марсе',      desc: 'Снарядите экспедицию на Марс',      kind: 'planet', key: 'mars',    goal: 1,    reward: 3 },
  { id: 'a_ast50',   icon: '☄️', name: 'Гроза астероидов',     desc: 'Сбейте 50 астероидов',             kind: 'stat', key: 'asteroids', goal: 50,   reward: 4 },
  { id: 'a_reb5',    icon: '♾️', name: 'Вечный цикл',          desc: 'Совершите 5 престижей',             kind: 'rebirths',               goal: 5,    reward: 5 },
  { id: 'a_mars5',   icon: '🌊', name: 'Зелёный Марс',         desc: 'Достигните 5-го этапа Марса',       kind: 'era',  key: 'mars',      goal: 5,    reward: 4 },
  { id: 'a_jup',     icon: '🟠', name: 'К гиганту',            desc: 'Снарядите экспедицию на Юпитер',    kind: 'planet', key: 'jupiter', goal: 1,    reward: 5 },
  { id: 'a_build5k', icon: '🌆', name: 'Градостроитель',       desc: 'Постройте 5 000 зданий',            kind: 'stat', key: 'built',     goal: 5000, reward: 4 },
  { id: 'a_jup5',    icon: '⚡', name: 'Повелитель бурь',      desc: 'Достигните 5-го этапа Юпитера',     kind: 'era',  key: 'jupiter',   goal: 5,    reward: 6 },
  { id: 'a_chest',   icon: '🎁', name: 'Кладоискатель',        desc: 'Откройте сундук',                   kind: 'stat', key: 'chests',    goal: 1,    reward: 1 },
  { id: 'a_reb15',   icon: '🌌', name: 'Повелитель циклов',    desc: 'Совершите 15 престижей',            kind: 'rebirths',               goal: 15,   reward: 8 },
  { id: 'a_era15',   icon: '🗼', name: 'Галактический маяк',   desc: 'Достигните 15-й эпохи Земли',       kind: 'era',  key: 'earth',     goal: 15,   reward: 8 },
  { id: 'a_mars10',  icon: '🏡', name: 'Второй дом',           desc: 'Достигните 10-го этапа Марса',      kind: 'era',  key: 'mars',      goal: 10,   reward: 8 },
  { id: 'a_jup10',   icon: '🌟', name: 'Второе Солнце',        desc: 'Достигните 10-го этапа Юпитера',    kind: 'era',  key: 'jupiter',   goal: 10,   reward: 10 },
  // Венера и Меркурий
  { id: 'a_venus',   icon: '🟡', name: 'Под кислотным небом',  desc: 'Снарядите экспедицию на Венеру',    kind: 'planet', key: 'venus',   goal: 1,    reward: 6 },
  { id: 'a_venus5',  icon: '⛱️', name: 'Тень для Венеры',      desc: 'Достигните 5-го этапа Венеры',      kind: 'era',  key: 'venus',     goal: 5,    reward: 7 },
  { id: 'a_venus10', icon: '🌅', name: 'Утренняя звезда',      desc: 'Достигните 10-го этапа Венеры',     kind: 'era',  key: 'venus',     goal: 10,   reward: 10 },
  { id: 'a_merc',    icon: '🌑', name: 'Ближе к Солнцу',       desc: 'Снарядите экспедицию на Меркурий',  kind: 'planet', key: 'mercury', goal: 1,    reward: 7 },
  { id: 'a_merc5',   icon: '🛤️', name: 'Рельсы в космос',      desc: 'Достигните 5-го этапа Меркурия',    kind: 'era',  key: 'mercury',   goal: 5,    reward: 8 },
  { id: 'a_merc10',  icon: '✴️', name: 'Сфера Дайсона',        desc: 'Достигните 10-го этапа Меркурия',   kind: 'era',  key: 'mercury',   goal: 10,   reward: 12 },
  { id: 'a_allmax',  icon: '👑', name: 'Повелитель системы',   desc: 'Пройдите все этапы на всех пяти планетах', kind: 'allmax',     goal: 5,    reward: 25 },
  // тапы, стройка, престижи
  { id: 'a_taps50k', icon: '🖐️', name: 'Стальной палец',       desc: 'Сделайте 50 000 тапов',             kind: 'stat', key: 'taps',      goal: 50000,  reward: 4 },
  { id: 'a_taps250k',icon: '🥁', name: 'Барабанщик',           desc: 'Сделайте 250 000 тапов',            kind: 'stat', key: 'taps',      goal: 250000, reward: 8 },
  { id: 'a_build25k',icon: '🌇', name: 'Мегаполис',            desc: 'Постройте 25 000 зданий',           kind: 'stat', key: 'built',     goal: 25000,  reward: 6 },
  { id: 'a_reb50',   icon: '🌀', name: 'Мастер престижа',      desc: 'Совершите 50 престижей',            kind: 'rebirths',               goal: 50,     reward: 10 },
  { id: 'a_reb100',  icon: '💫', name: 'Сотня циклов',         desc: 'Совершите 100 престижей',           kind: 'rebirths',               goal: 100,    reward: 15 },
  { id: 'a_reb200',  icon: '🌠', name: 'Вечный странник',      desc: 'Совершите 200 престижей',           kind: 'rebirths',               goal: 200,    reward: 20 },
  // астероиды, сундуки, время, образ
  { id: 'a_ast200',  icon: '🛰️', name: 'Небесный страж',       desc: 'Сбейте 200 астероидов',            kind: 'stat', key: 'asteroids', goal: 200,    reward: 8 },
  { id: 'a_gold10',  icon: '🌟', name: 'Золотой фонд',         desc: 'Сбейте 10 золотых астероидов',     kind: 'stat', key: 'golden',    goal: 10,     reward: 5 },
  { id: 'a_chest10', icon: '🧰', name: 'Коллекционер',         desc: 'Откройте 10 сундуков',              kind: 'stat', key: 'chests',    goal: 10,     reward: 4 },
  { id: 'a_hours',   icon: '🕰️', name: 'Старожил',             desc: 'Проведите в игре 10 часов',         kind: 'hours',                  goal: 10,     reward: 5 },
  { id: 'a_style5',  icon: '👗', name: 'Икона стиля',          desc: 'Соберите 5 образов',                kind: 'style',                  goal: 5,      reward: 3 },
  // друзья и альянс
  { id: 'a_friend1', icon: '🤝', name: 'Не один во Вселенной', desc: 'Добавьте друга по коду',            kind: 'stat', key: 'friends',   goal: 1,      reward: 2 },
  { id: 'a_friend5', icon: '👥', name: 'Экипаж',               desc: 'Соберите 5 друзей',                 kind: 'stat', key: 'friends',   goal: 5,      reward: 4 },
  { id: 'a_ally',    icon: '🛡️', name: 'Плечом к плечу',       desc: 'Вступите в альянс',                 kind: 'stat', key: 'alliance',  goal: 1,      reward: 3 }
];

// Для Node (симуляция баланса и тесты)
if (typeof module !== 'undefined') module.exports = { GAME_VERSION, RES, PLANETS, PLANET_ORDER, GLOBAL_PERKS, COSMETICS, PRESTIGE, prestigeGoals, prestigeGems, CHESTS, BUY_MODES, BUILD_GROWTH, DAILY_QUESTS, DAILY_COUNT, DAILY_BONUS, ACHIEVEMENTS };
