-- Terra 3D для Roblox: данные Земли и экономика (общий модуль для сервера и клиента).
-- Те же эпохи, постройки, цены и формулы, что в основной игре (web/js/data.js, web/js/game.js).
-- Модуль чистый: не трогает Roblox API, поэтому его можно проверять тестами вне Roblox.

local Shared = {}

Shared.VERSION = 1
Shared.GROWTH = 1.18            -- каждая следующая постройка дороже на 18%
Shared.OFFLINE_MAX_SEC = 8 * 3600
Shared.OFFLINE_EFFICIENCY = 0.5
Shared.GOLDEN_CHANCE = 0.12
Shared.ASTEROID_FLIGHT = 15     -- секунд до удара
Shared.ASTEROID_FIRST = { 90, 150 }
Shared.ASTEROID_NEXT = { 150, 300 }
Shared.BUY_MODES = { 1, 10, 50, 100, "max" }

Shared.RES_ORDER = { "solar", "water", "air", "biomass", "science" }
Shared.RES = {
	solar = { name = "Солнце", icon = "☀️", color = { 251, 191, 36 } },
	water = { name = "Вода", icon = "💧", color = { 56, 189, 248 } },
	air = { name = "Воздух", icon = "💨", color = { 186, 230, 253 } },
	biomass = { name = "Биомасса", icon = "🌱", color = { 74, 222, 128 } },
	science = { name = "Наука", icon = "🔬", color = { 196, 181, 253 } },
	gems = { name = "Кристаллы", icon = "💎", color = { 129, 140, 248 } },
}
Shared.CLICK_RES = "solar"
Shared.START = { solar = 100, water = 50 }

Shared.ERAS = {
	{ name = "Протопланета", desc = "Раскалённый шар лавы и вулканов. Здесь всё только начинается.", click = 1, halo = { 249, 115, 22 } },
	{ name = "Первичный океан", desc = "Кометы принесли воду — планету покрыл бескрайний океан.", click = 3, halo = { 14, 165, 233 }, cost = { solar = 150, water = 60 } },
	{ name = "Рождение атмосферы", desc = "Гейзеры и вулканы наполнили небо газами. Появились облака.", click = 7, halo = { 56, 189, 248 }, cost = { solar = 350, water = 200, air = 100 } },
	{ name = "Первая жизнь", desc = "В тёплых морях зародились первые микробы и водоросли.", click = 15, halo = { 45, 212, 191 }, cost = { water = 900, air = 600, biomass = 60 } },
	{ name = "Расцвет биосферы", desc = "Континенты зазеленели, воздух стал пригодным для дыхания.", click = 30, halo = { 34, 197, 94 }, cost = { water = 3000, air = 2500, biomass = 900 } },
	{ name = "Эпоха гигантов", desc = "По планете бродят исполинские ящеры, джунгли до небес.", click = 60, halo = { 22, 163, 74 }, cost = { solar = 7000, air = 5000, biomass = 3000 } },
	{ name = "Первые цивилизации", desc = "Огонь, земледелие и первые города. Появилась наука.", click = 120, halo = { 234, 179, 8 }, cost = { solar = 25000, water = 18000, biomass = 12000 } },
	{ name = "Индустриальная эра", desc = "Фабрики, железные дороги и смог над мегаполисами.", click = 260, halo = { 245, 158, 11 }, cost = { solar = 90000, biomass = 40000, science = 2000 } },
	{ name = "Космическая эра", desc = "Ракеты уходят к звёздам. Скоро — путь к Марсу!", click = 550, halo = { 96, 165, 250 }, cost = { solar = 350000, air = 150000, science = 12000 } },
	{ name = "Звёздная империя", desc = "Рой Дайсона питает цивилизацию, покоряющую систему.", click = 1200, halo = { 192, 132, 252 }, cost = { solar = 1800000, water = 600000, science = 80000 } },
	{ name = "Орбитальные кольца", desc = "Города на кольце вокруг планеты, лифты до самой орбиты.", click = 2600, halo = { 56, 189, 248 }, cost = { solar = 12e6, air = 4e6, science = 5e5 } },
	{ name = "Планетарный разум", desc = "Сеть ИИ бережно управляет климатом, океанами и лесами.", click = 5600, halo = { 34, 211, 238 }, cost = { solar = 8e7, water = 3e7, science = 3e6 } },
	{ name = "Звёздные врата", desc = "Кольцо-портал на орбите открывает путь к другим звёздам.", click = 12000, halo = { 167, 139, 250 }, cost = { solar = 6e8, air = 2.5e8, science = 6e7 } },
	{ name = "Межзвёздная держава", desc = "Колонии Земли сияют в соседних звёздных системах.", click = 26000, halo = { 244, 114, 182 }, cost = { solar = 2e10, biomass = 2e9, science = 2e9 } },
	{ name = "Галактический маяк", desc = "Свет Земли виден с другого края галактики.", click = 56000, halo = { 253, 230, 138 }, cost = { solar = 1.5e11, water = 5e10, science = 1.5e10 } },
}
Shared.MAX_ERA = #Shared.ERAS - 1   -- эпохи считаются с нуля, как в основной игре

-- u — эпоха (с нуля), с которой постройка открывается
Shared.BUILDINGS = {
	{ id = "solar_collector", u = 0, name = "Поглотитель света", icon = "🔆", desc = "Улавливает солнечные фотоны.", cost = { solar = 15 }, prod = { solar = 2.5 } },
	{ id = "ice_comet", u = 0, name = "Притяжение комет", icon = "☄️", desc = "Направляет ледяные кометы в океаны.", cost = { solar = 30 }, prod = { water = 1.8 } },
	{ id = "geyser", u = 1, name = "Гейзеры", icon = "🌋", desc = "Выбрасывают пар и газы.", cost = { solar = 75, water = 25 }, prod = { water = 3.5, air = 1.8 } },
	{ id = "gas_separator", u = 2, name = "Ионизатор неба", icon = "🌪️", desc = "Формирует воздушный слой.", cost = { solar = 220, water = 120 }, prod = { air = 6.5 } },
	{ id = "cyanobacteria", u = 2, name = "Цианобактерии", icon = "🦠", desc = "Первые микробы выделяют кислород.", cost = { solar = 180, water = 100, air = 30 }, prod = { air = 4.5, biomass = 1.8 } },
	{ id = "coral_reef", u = 3, name = "Коралловые рифы", icon = "🐚", desc = "Богатые подводные экосистемы.", cost = { water = 450, air = 250, biomass = 40 }, prod = { biomass = 5.5, water = 6 } },
	{ id = "thunderstorm", u = 4, name = "Грозовые фронты", icon = "🌩️", desc = "Молнии заряжают атмосферу.", cost = { solar = 2500, air = 1200 }, prod = { solar = 40, air = 15 } },
	{ id = "relic_forest", u = 4, name = "Реликтовые леса", icon = "🌲", desc = "Озеленяют континенты.", cost = { solar = 800, water = 600, biomass = 180 }, prod = { air = 16, biomass = 13 } },
	{ id = "ocean_currents", u = 5, name = "Океанские течения", icon = "🌊", desc = "Перемешивают тепло и воду.", cost = { solar = 9000, water = 6000 }, prod = { water = 120, solar = 60 } },
	{ id = "fauna", u = 5, name = "Гиганты", icon = "🦕", desc = "Исполинские ящеры удобряют землю.", cost = { air = 5000, biomass = 2500 }, prod = { biomass = 70 } },
	{ id = "tribes", u = 6, name = "Первые племена", icon = "🔥", desc = "Огонь, орудия и первые знания.", cost = { solar = 20000, biomass = 9000 }, prod = { biomass = 120, science = 4 } },
	{ id = "farms", u = 6, name = "Земледелие", icon = "🌾", desc = "Поля кормят растущие народы.", cost = { water = 30000, biomass = 15000 }, prod = { biomass = 400, science = 3 } },
	{ id = "ancient_academy", u = 6, name = "Библиотеки", icon = "🏛️", desc = "Хранят и умножают знания.", cost = { solar = 30000, biomass = 12000 }, prod = { science = 15, solar = 150 } },
	{ id = "factories", u = 7, name = "Фабрики", icon = "🏭", desc = "Паровые машины и конвейеры.", cost = { solar = 120000, science = 2500 }, prod = { solar = 1500, science = 40 } },
	{ id = "eco_city", u = 7, name = "Мегаполисы", icon = "🏙️", desc = "Огни городов видны из космоса.", cost = { solar = 250000, air = 80000, science = 6000 }, prod = { science = 250, solar = 1200, biomass = 600 } },
	{ id = "spaceport", u = 8, name = "Космодром", icon = "🚀", desc = "Запуски к другим мирам.", cost = { solar = 900000, science = 30000 }, prod = { science = 1200, solar = 6000 } },
	{ id = "orbital_mirror", u = 8, name = "Орбитальные зеркала", icon = "🛰️", desc = "Собирают свет на орбите.", cost = { solar = 2000000, science = 80000 }, prod = { solar = 25000, air = 5000 } },
	{ id = "dyson_swarm", u = 9, name = "Рой Дайсона", icon = "🌞", desc = "Мегаструктура вокруг Солнца.", cost = { solar = 15000000, science = 800000 }, prod = { solar = 250000, water = 60000, air = 60000, science = 20000 } },
	{ id = "weather_net", u = 10, name = "Погодная сеть", icon = "⛈️", desc = "Спутники управляют дождями и ветрами.", cost = { air = 2e7, water = 2e7 }, prod = { air = 7e5, water = 6e5 } },
	{ id = "orbital_ring", u = 10, name = "Орбитальное кольцо", icon = "⭕", desc = "Город длиной в экватор.", cost = { solar = 6e7, science = 2.5e6 }, prod = { solar = 1.4e6, science = 6e4 } },
	{ id = "gaia_ai", u = 11, name = "Разум Геи", icon = "🧠", desc = "ИИ, который заботится о биосфере.", cost = { air = 4e7, science = 1.2e7 }, prod = { biomass = 1e6, air = 7e5, water = 7e5, science = 1.8e5 } },
	{ id = "fusion_ocean", u = 12, name = "Термоядерные моря", icon = "♨️", desc = "Океаны дают энергию синтеза.", cost = { water = 3e8, solar = 3e8 }, prod = { water = 9e6, solar = 7e6, air = 2.5e6 } },
	{ id = "ark_gardens", u = 12, name = "Сады-ковчеги", icon = "🌴", desc = "Парящие сады со всей жизнью Земли.", cost = { water = 1.5e8, air = 1e8 }, prod = { biomass = 6e6, air = 3.5e6 } },
	{ id = "stargate", u = 13, name = "Звёздные врата", icon = "⛩️", desc = "Портал к другим звёздам.", cost = { solar = 5e10, science = 4e9 }, prod = { science = 6e7, solar = 6e8, water = 2e8 } },
	{ id = "beacon", u = 14, name = "Галактический маяк", icon = "🗼", desc = "Луч, видимый всей галактике.", cost = { solar = 6e11, science = 6e10 }, prod = { solar = 6e9, water = 1.5e9, air = 1.5e9, biomass = 6e8, science = 6e8 } },
}
Shared.BUILDING_BY_ID = {}
for i, b in ipairs(Shared.BUILDINGS) do
	b.index = i
	Shared.BUILDING_BY_ID[b.id] = b
end

-- Улучшения Земли (за кристаллы): step — прибавка за уровень
Shared.PERKS = {
	{ id = "gaia", name = "Дыхание Геи", icon = "🌿", kind = "prod", step = 0.25, max = 5, base = 1, scale = 1.8, desc = "Постройки производят больше." },
	{ id = "tectonics", name = "Тектоника", icon = "🌋", kind = "click", step = 0.5, max = 5, base = 1, scale = 1.8, desc = "Тапы по планете сильнее." },
	{ id = "oceans", name = "Мудрость океанов", icon = "🌊", kind = "cheap", step = 0.08, max = 5, base = 1, scale = 1.8, desc = "Постройки и эпохи дешевле." },
}
-- Древо Вечности (общие улучшения)
Shared.GLOBAL_PERKS = {
	{ id = "autoclicker", name = "Автокликер и ПВО", icon = "🤖", max = 10, base = 1, scale = 1.6, desc = "Спутник тапает по планете и сбивает астероиды." },
	{ id = "time_warp", name = "Искажение времени", icon = "⏳", max = 5, base = 1, scale = 2.0, desc = "Ускоряет всё производство." },
	{ id = "cheap_build", name = "Квантовая архитектура", icon = "📐", max = 5, base = 1, scale = 1.8, desc = "Всё строится дешевле." },
	{ id = "starter_pack", name = "Ковчег предтеч", icon = "📦", max = 5, base = 1, scale = 1.8, desc = "Запас ресурсов после престижа." },
	{ id = "crit_solar", name = "Сверхзаряд", icon = "💥", max = 5, base = 2, scale = 2.0, desc = "15% шанс критического тапа и удара." },
}
Shared.PERK_BY_ID = {}
for _, p in ipairs(Shared.PERKS) do Shared.PERK_BY_ID[p.id] = p end
Shared.GLOBAL_BY_ID = {}
for _, p in ipairs(Shared.GLOBAL_PERKS) do Shared.GLOBAL_BY_ID[p.id] = p end

Shared.PRESTIGE = { baseStage = 4, buildBase = 30, buildStep = 22, buildSq = 3, buildCap = 1100 }

-- ============================================================
--  Состояние игрока
-- ============================================================
local function finite(x)
	return type(x) == "number" and x == x and x ~= math.huge and x ~= -math.huge
end
Shared.finite = finite

function Shared.newState()
	local st = {
		v = Shared.VERSION,
		era = 0,
		res = {},
		counts = {},
		gems = 0,
		ppr = 0,                 -- сколько престижей сделано
		perks = {},              -- Древо Вечности
		ppk = {},                -- улучшения Земли
		stats = { taps = 0, built = 0, asteroids = 0, golden = 0, evolves = 0, playSec = 0, maxEra = 0 },
		lastSave = 0,
	}
	for _, k in ipairs(Shared.RES_ORDER) do st.res[k] = Shared.START[k] or 0 end
	return st
end

-- Сохранение из DataStore → проверенное состояние (лишнее и битое отбрасывается)
function Shared.sanitize(raw)
	local st = Shared.newState()
	if type(raw) ~= "table" then return st end
	local function n(x, lo, hi)
		if not finite(x) then return lo end
		if x < lo then return lo end
		if hi and x > hi then return hi end
		return x
	end
	st.era = math.floor(n(raw.era, 0, Shared.MAX_ERA))
	if type(raw.res) == "table" then
		for _, k in ipairs(Shared.RES_ORDER) do st.res[k] = n(raw.res[k], 0, 1e300) end
	end
	if type(raw.counts) == "table" then
		for _, b in ipairs(Shared.BUILDINGS) do
			local c = math.floor(n(raw.counts[b.id], 0, 100000))
			if c > 0 then st.counts[b.id] = c end
		end
	end
	st.gems = math.floor(n(raw.gems, 0, 1e12))
	st.ppr = math.floor(n(raw.ppr, 0, 1e6))
	if type(raw.perks) == "table" then
		for _, p in ipairs(Shared.GLOBAL_PERKS) do
			local l = math.floor(n(raw.perks[p.id], 0, p.max))
			if l > 0 then st.perks[p.id] = l end
		end
	end
	if type(raw.ppk) == "table" then
		for _, p in ipairs(Shared.PERKS) do
			local l = math.floor(n(raw.ppk[p.id], 0, p.max))
			if l > 0 then st.ppk[p.id] = l end
		end
	end
	if type(raw.stats) == "table" then
		for k, _ in pairs(st.stats) do st.stats[k] = n(raw.stats[k], 0, 1e15) end
	end
	st.stats.maxEra = math.max(st.stats.maxEra, st.era)
	st.lastSave = n(raw.lastSave, 0, 1e12)
	return st
end

-- ============================================================
--  Экономика (те же формулы, что в основной игре)
-- ============================================================
function Shared.perk(st, id) return st.perks[id] or 0 end
function Shared.ppk(st, id) return st.ppk[id] or 0 end
function Shared.perkCost(p, lvl) return math.ceil(p.base * p.scale ^ lvl) end

function Shared.perkBonus(st, kind)
	local b = 0
	for _, p in ipairs(Shared.PERKS) do
		if p.kind == kind then b = b + p.step * Shared.ppk(st, p.id) end
	end
	return b
end
function Shared.planetMult(st) return 1 + st.ppr end
function Shared.speedMult(st) return 1 + Shared.perk(st, "time_warp") * 0.25 end
function Shared.prodMult(st, boost)
	return Shared.planetMult(st) * Shared.speedMult(st) * (boost and 2 or 1) * (1 + Shared.perkBonus(st, "prod"))
end
function Shared.clickGain(st, boost)
	local e = Shared.ERAS[st.era + 1]
	return math.ceil(e.click * Shared.planetMult(st) * (boost and 2 or 1) * (1 + Shared.perkBonus(st, "click")))
end
function Shared.costMult(st)
	return math.max(0.3, (1 - Shared.perk(st, "cheap_build") * 0.10) * (1 - Shared.perkBonus(st, "cheap")))
end
function Shared.critMult(st, roll)   -- roll — случайное число 0..1
	local l = Shared.perk(st, "crit_solar")
	if l > 0 and roll < 0.15 then return 2 + l end
	return 1
end

function Shared.rates(st, boost)
	local r = {}
	for _, k in ipairs(Shared.RES_ORDER) do r[k] = 0 end
	local m = Shared.prodMult(st, boost)
	for _, b in ipairs(Shared.BUILDINGS) do
		local c = st.counts[b.id] or 0
		if c > 0 then
			for k, v in pairs(b.prod) do r[k] = r[k] + v * c * m end
		end
	end
	return r
end

local function scaled(cost, mult)
	local s = {}
	for k, v in pairs(cost) do s[k] = math.max(1, math.ceil(v * mult)) end
	return s
end
function Shared.canPay(st, cost)
	if not cost then return false end
	for k, v in pairs(cost) do
		local have = (k == "gems") and st.gems or (st.res[k] or 0)
		if have < v then return false end
	end
	return true
end
function Shared.pay(st, cost)
	for k, v in pairs(cost) do
		if k == "gems" then st.gems = math.max(0, st.gems - v) else st.res[k] = math.max(0, (st.res[k] or 0) - v) end
	end
end

-- Цена n построек подряд — сумма геометрической прогрессии
function Shared.bulkCost(st, b, n)
	n = n or 1
	local g, c = Shared.GROWTH, st.counts[b.id] or 0
	return scaled(b.cost, g ^ c * (g ^ n - 1) / (g - 1) * Shared.costMult(st))
end
function Shared.maxAffordable(st, b, cap)
	cap = cap or 1000
	local g, c, m = Shared.GROWTH, st.counts[b.id] or 0, Shared.costMult(st)
	local n = cap
	for k, v in pairs(b.cost) do
		local unit = v * m * g ^ c
		local have = st.res[k] or 0
		local k2 = math.floor(math.log(have * (g - 1) / unit + 1) / math.log(g) + 1e-9)
		if k2 < n then n = k2 end
	end
	if not finite(n) or n < 0 then n = 0 end
	while n > 0 and not Shared.canPay(st, Shared.bulkCost(st, b, n)) do n = n - 1 end
	return n
end
function Shared.buyCount(st, b, mode)
	if mode == "max" then return math.max(1, Shared.maxAffordable(st, b)) end
	return mode
end

function Shared.eraCost(st)
	local nxt = Shared.ERAS[st.era + 2]
	if not nxt then return nil end
	return scaled(nxt.cost, Shared.costMult(st))
end
function Shared.buildingsTotal(st)
	local t = 0
	for _, c in pairs(st.counts) do t = t + c end
	return t
end

-- ---------- Престиж ----------
function Shared.prestigeGoals(n)
	local C, max = Shared.PRESTIGE, Shared.MAX_ERA
	local want = C.baseStage + n
	local goals = {
		{ kind = "stage", need = math.min(max, want) },
		{ kind = "build", need = math.min(C.buildCap, C.buildBase + C.buildStep * n + C.buildSq * n * n) },
	}
	if want > max then
		local base = Shared.ERAS[max + 1].cost.solar
		table.insert(goals, { kind = "res", res = "solar", need = math.floor(base * 2 * (want - max) ^ 1.75 + 0.5) })
	end
	return goals
end
function Shared.prestigeGems(n, era) return 2 + math.floor(era / 2) + math.floor(n * 0.75) end
function Shared.prestigeInfo(st)
	local goals = Shared.prestigeGoals(st.ppr)
	local ready = true
	for _, g in ipairs(goals) do
		if g.kind == "stage" then g.have = st.era; g.ok = st.era >= g.need
		elseif g.kind == "build" then g.have = Shared.buildingsTotal(st); g.ok = g.have >= g.need
		else g.have = st.res[g.res] or 0; g.ok = g.have >= g.need end
		if not g.ok then ready = false end
	end
	return { n = st.ppr, goals = goals, ready = ready, gems = Shared.prestigeGems(st.ppr, st.era), nextMult = st.ppr + 2 }
end

-- Общий топ: престиж — 100 очков, эпоха — 1 очко (как в основной игре)
function Shared.score(st) return st.ppr * 100 + st.era end

-- ============================================================
--  Действия (вызывает сервер; возвращают true/false и подробности)
-- ============================================================
function Shared.tick(st, dt, boost)
	if dt <= 0 then return end
	local r = Shared.rates(st, boost)
	for k, v in pairs(r) do st.res[k] = st.res[k] + v * dt end
end

function Shared.offline(st, sec)
	sec = math.min(sec, Shared.OFFLINE_MAX_SEC)
	if sec <= 60 then return 0 end
	local r = Shared.rates(st, false)
	for k, v in pairs(r) do st.res[k] = st.res[k] + v * sec * Shared.OFFLINE_EFFICIENCY end
	return r.solar * sec * Shared.OFFLINE_EFFICIENCY
end

function Shared.tap(st, count, rolls)
	local gain = 0
	local g = Shared.clickGain(st, false)
	for i = 1, count do gain = gain + g * Shared.critMult(st, rolls and rolls[i] or 1) end
	st.res.solar = st.res.solar + gain
	st.stats.taps = st.stats.taps + count
	return gain
end

function Shared.buy(st, id, mode)
	local b = Shared.BUILDING_BY_ID[id]
	if not b or b.u > st.era then return false, "locked" end
	local want = 1
	if mode == "max" then want = 1000
	elseif mode == 10 or mode == 50 or mode == 100 then want = mode end
	local n = math.min(want, Shared.maxAffordable(st, b, want))
	if n < 1 then return false, "no_money" end
	local cost = Shared.bulkCost(st, b, n)
	if not Shared.canPay(st, cost) then return false, "no_money" end
	Shared.pay(st, cost)
	st.counts[id] = (st.counts[id] or 0) + n
	st.stats.built = st.stats.built + n
	return true, n
end

function Shared.evolve(st)
	local cost = Shared.eraCost(st)
	if not cost then return false, "max" end
	if not Shared.canPay(st, cost) then return false, "no_money" end
	Shared.pay(st, cost)
	st.era = st.era + 1
	st.stats.evolves = st.stats.evolves + 1
	st.stats.maxEra = math.max(st.stats.maxEra, st.era)
	return true
end

function Shared.prestige(st)
	local info = Shared.prestigeInfo(st)
	if not info.ready then return false, "not_ready" end
	st.gems = st.gems + info.gems
	st.ppr = st.ppr + 1
	st.era = 0
	st.counts = {}
	for _, k in ipairs(Shared.RES_ORDER) do st.res[k] = Shared.START[k] or 0 end
	local starter = Shared.perk(st, "starter_pack") * 300
	st.res.solar = st.res.solar + starter
	st.res.water = st.res.water + starter
	st.res.air = st.res.air + starter
	return true, info.gems
end

function Shared.buyPerk(st, id)
	local p = Shared.PERK_BY_ID[id]
	if not p then return false, "unknown" end
	local lvl = Shared.ppk(st, id)
	if lvl >= p.max then return false, "max" end
	local c = Shared.perkCost(p, lvl)
	if st.gems < c then return false, "no_money" end
	st.gems = st.gems - c
	st.ppk[id] = lvl + 1
	return true
end

function Shared.buyGlobal(st, id)
	local p = Shared.GLOBAL_BY_ID[id]
	if not p then return false, "unknown" end
	local lvl = Shared.perk(st, id)
	if lvl >= p.max then return false, "max" end
	local c = Shared.perkCost(p, lvl)
	if st.gems < c then return false, "no_money" end
	st.gems = st.gems - c
	st.perks[id] = lvl + 1
	return true
end

-- Награда за астероид: кристаллы и запас ресурса тапа
function Shared.asteroidReward(st, golden)
	local gems = (1 + math.floor(st.era / 3)) * (golden and 3 or 1)
	local bonus = math.max(Shared.clickGain(st, false) * 40, math.ceil(Shared.rates(st, false).solar * 45))
	return gems, bonus
end
function Shared.asteroidHp(st, golden) return Shared.clickGain(st, false) * (golden and 18 or 14) end

-- ============================================================
--  Текст
-- ============================================================
local function fixed(x, d) return string.format("%." .. d .. "f", x) end
function Shared.fmt(n)
	if not finite(n) then return "0" end
	if n >= 1e21 then return (string.gsub(string.format("%.2e", n), "e%+0*", "e")) end
	if n >= 1e18 then return fixed(n / 1e18, 2) .. "Qi" end
	if n >= 1e15 then return fixed(n / 1e15, 2) .. "Q" end
	if n >= 1e12 then return fixed(n / 1e12, 2) .. "T" end
	if n >= 1e9 then return fixed(n / 1e9, 2) .. "B" end
	if n >= 1e6 then return fixed(n / 1e6, 2) .. "M" end
	if n >= 1e3 then return fixed(n / 1e3, 1) .. "K" end
	return tostring(math.floor(n))
end
function Shared.fmtRate(x)
	if x >= 1000 then return Shared.fmt(x) end
	if x >= 100 then return tostring(math.floor(x + 0.5)) end
	return fixed(x, 1)
end
function Shared.costText(cost)
	local parts = {}
	for _, k in ipairs(Shared.RES_ORDER) do
		if cost[k] then table.insert(parts, Shared.RES[k].icon .. " " .. Shared.fmt(cost[k])) end
	end
	if cost.gems then table.insert(parts, "💎 " .. Shared.fmt(cost.gems)) end
	return table.concat(parts, "  ")
end
function Shared.plural(n, one, few, many)
	local a = math.abs(n) % 100
	local b = a % 10
	if a > 10 and a < 20 then return many end
	if b == 1 then return one end
	if b > 1 and b < 5 then return few end
	return many
end

return Shared
