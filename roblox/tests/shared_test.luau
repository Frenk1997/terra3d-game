-- Проверка экономики Roblox-версии (TerraShared) без Roblox: luau roblox/tests/shared_test.luau
local Shared = require("../src/shared/TerraShared")

local pass, fail = 0, 0
local function ok(cond, name, extra)
	if cond then pass += 1; print("  ✓ " .. name)
	else fail += 1; print("  ✗ " .. name .. (extra and ("  " .. tostring(extra)) or "")) end
end
local function near(a, b) return math.abs(a - b) <= math.max(1e-6, math.abs(b) * 1e-9) end

print("Старт")
local st = Shared.newState()
ok(st.res.solar == 100 and st.res.water == 50 and st.era == 0, "стартовые ресурсы и эпоха")
ok(Shared.clickGain(st, false) == 1, "тап на 1-й эпохе = 1")
ok(#Shared.ERAS == 15 and #Shared.BUILDINGS == 25, "15 эпох и 25 построек, как в основной игре")

print("Постройки")
local col = Shared.BUILDING_BY_ID.solar_collector
ok(Shared.bulkCost(st, col, 1).solar == 15, "первый поглотитель стоит 15 ☀️")
local c10 = Shared.bulkCost(st, col, 10).solar
ok(c10 == math.ceil(15 * (1.18 ^ 10 - 1) / 0.18), "×10 — сумма прогрессии", c10)
st.res.solar = 1000
local n = Shared.maxAffordable(st, col)
ok(n > 0 and Shared.canPay(st, Shared.bulkCost(st, col, n)) and not Shared.canPay(st, Shared.bulkCost(st, col, n + 1)), "MAX — ровно на сколько хватает", n)
local okBuy, bought = Shared.buy(st, "solar_collector", "max")
ok(okBuy and bought == n and st.counts.solar_collector == n and st.res.solar < 1000, "покупка MAX")
ok(not Shared.buy(st, "geyser", 1), "гейзеры закрыты до 2-й эпохи")
ok(near(Shared.rates(st, false).solar, 2.5 * n), "доход = 2.5 ☀️/с за поглотитель")
local before = st.res.solar
Shared.tick(st, 10, false)
ok(near(st.res.solar - before, 25 * n), "за 10 секунд")

print("Эпохи")
st.res.solar, st.res.water = 1000, 1000
ok(Shared.evolve(st) and st.era == 1 and st.stats.maxEra == 1, "эволюция во 2-ю эпоху")
ok(Shared.clickGain(st, false) == 3, "тап во 2-й эпохе = 3")
local e = Shared.newState(); e.era = Shared.MAX_ERA
ok(Shared.eraCost(e) == nil and not Shared.evolve(e), "после 15-й эпохи эволюции нет")

print("Престиж")
local p = Shared.newState()
local g = Shared.prestigeGoals(0)
ok(#g == 2 and g[1].need == 4 and g[2].need == 30, "первый престиж: 5-я эпоха и 30 построек")
ok(not Shared.prestigeInfo(p).ready, "сразу престиж нельзя")
p.era = 4; p.counts.solar_collector = 30
local info = Shared.prestigeInfo(p)
ok(info.ready and info.gems == 2 + 2 + 0, "цели выполнены, награда 4 💎", info.gems)
p.perks.starter_pack = 2
ok(Shared.prestige(p) and p.ppr == 1 and p.era == 0 and next(p.counts) == nil and p.gems == 4, "престиж: сброс Земли, кристаллы")
ok(p.res.solar == 100 + 600 and p.res.air == 600, "Ковчег предтеч: +300 за уровень")
ok(Shared.clickGain(p, false) == 2 and Shared.prodMult(p, false) == 2, "доход и тап ×2")
local g11 = Shared.prestigeGoals(11)
ok(#g11 == 3 and g11[3].kind == "res" and g11[3].need == math.floor(1.5e11 * 2 + 0.5), "эпохи кончились — копить ☀️", g11[3] and g11[3].need)
local g13 = Shared.prestigeGoals(13)
ok(g13[3].need > g11[3].need * 4, "цель по ☀️ растёт плавно")
ok(Shared.prestigeGoals(20)[2].need == 1100, "построек в цели — не больше 1100")

print("Улучшения")
local u = Shared.newState(); u.gems = 10
ok(Shared.buyGlobal(u, "cheap_build") and u.gems == 9 and u.perks.cheap_build == 1, "Квантовая архитектура за 1 💎")
ok(near(Shared.costMult(u), 0.9), "скидка 10%")
ok(Shared.buyPerk(u, "oceans") and near(Shared.costMult(u), 0.9 * 0.92), "Мудрость океанов: ещё −8%")
u.perks.cheap_build = 5; u.ppk.oceans = 5
ok(Shared.costMult(u) == 0.3, "скидка не больше 70%")
local w = Shared.newState(); w.gems = 1000; w.perks.autoclicker = 10
ok(not Shared.buyGlobal(w, "autoclicker"), "выше максимума не купить")
ok(Shared.perkCost(Shared.GLOBAL_BY_ID.crit_solar, 0) == 2 and Shared.perkCost(Shared.GLOBAL_BY_ID.crit_solar, 2) == 8, "цены улучшений растут")
local cr = Shared.newState(); cr.perks.crit_solar = 3
ok(Shared.critMult(cr, 0.1) == 5 and Shared.critMult(cr, 0.5) == 1, "крит 15%: урон ×(2+ур.)")
ok(Shared.tap(cr, 3, { 0.1, 0.9, 0.9 }) == 5 + 1 + 1 and cr.stats.taps == 3, "тапы с критом")

print("Астероиды и офлайн")
local a = Shared.newState(); a.counts.solar_collector = 100
local gems, bonus = Shared.asteroidReward(a, false)
ok(gems == 1 and bonus == math.ceil(250 * 45), "астероид: 1 💎 и запас ☀️", bonus)
ok(select(1, Shared.asteroidReward(a, true)) == 3, "золотой — втрое больше кристаллов")
a.era = 9
ok(Shared.asteroidHp(a, false) == 1200 * 14, "прочность астероида — 14 тапов")
local o = Shared.newState(); o.counts.solar_collector = 10
local s0 = o.res.solar
Shared.offline(o, 3600)
ok(near(o.res.solar - s0, 25 * 3600 * 0.5), "офлайн — вполсилы")
local o2 = Shared.newState(); o2.counts.solar_collector = 10
Shared.offline(o2, 100 * 3600)
ok(near(o2.res.solar - 100, 25 * 8 * 3600 * 0.5), "офлайн — не больше 8 часов")
ok(Shared.offline(Shared.newState(), 30) == 0, "меньше минуты — ничего")

print("Сохранения")
local s = Shared.sanitize({ era = 99, res = { solar = 0 / 0, water = 1e400, air = -5, biomass = 12 }, counts = { solar_collector = 3.7, hacker = 9 }, gems = "много", ppr = 2, perks = { autoclicker = 99 }, ppk = { gaia = 2 } })
ok(s.era == Shared.MAX_ERA, "эпоха не больше 15-й")
ok(s.res.solar == 0 and s.res.water == 0 and s.res.air == 0 and s.res.biomass == 12, "битые числа отброшены")
ok(s.counts.solar_collector == 3 and s.counts.hacker == nil, "неизвестные постройки отброшены")
ok(s.gems == 0 and s.ppr == 2 and s.perks.autoclicker == 10 and s.ppk.gaia == 2, "уровни ограничены максимумом")
ok(Shared.sanitize(nil).res.solar == 100, "нет сохранения — новая игра")
ok(Shared.score(s) == 214, "очки топа: престиж 100 + эпоха")

print("Числа")
ok(Shared.fmt(999) == "999" and Shared.fmt(1234) == "1.2K" and Shared.fmt(1.5e6) == "1.50M" and Shared.fmt(2.5e9) == "2.50B", "K / M / B", Shared.fmt(1234))
ok(Shared.fmt(1e22) == "1.00e22", "очень большие — экспонента", Shared.fmt(1e22))
ok(Shared.costText({ solar = 150, water = 60 }) == "☀️ 150  💧 60", "цена текстом")
ok(Shared.plural(1, "а", "б", "в") == "а" and Shared.plural(3, "а", "б", "в") == "б" and Shared.plural(11, "а", "б", "в") == "в", "склонение")

print(string.format("\nИтого: %d пройдено, %d провалено", pass, fail))
if fail > 0 then error("тесты не прошли") end
