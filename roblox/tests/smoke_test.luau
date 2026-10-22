-- Дымовая проверка: сервер и клиент Terra 3D запускаются в «песочнице Roblox» (mock_roblox.luau),
-- игрок заходит, тапает, покупает, эволюционирует, сбивает астероид, делает престиж, выходит — без ошибок.
-- Запуск: python3 roblox/build.py && luau roblox/tests/smoke_test.luau
local M = require("./mock_roblox")
M.sources = require("./_sources")
local Enum = M.Enum

local pass, fail = 0, 0
local function ok(cond, name, extra)
	if cond then pass += 1; print("  ✓ " .. name)
	else fail += 1; print("  ✗ " .. name .. (extra ~= nil and ("  " .. tostring(extra)) or "")) end
end
local function noErrors(stage)
	if #M.errors > 0 then
		for _, e in ipairs(M.errors) do print("    " .. e) end
		ok(false, stage .. ": ошибки в скриптах", #M.errors)
		M.errors = {}
	else ok(true, stage .. ": без ошибок") end
end

-- место как в TerraRoblox.rbxlx
local game = M.newGame()
local RS = game:GetService("ReplicatedStorage")
local SSS = game:GetService("ServerScriptService")
local shared = M.newInstance("ModuleScript", "TerraShared"); shared.Parent = RS
local server = M.newInstance("Script", "TerraServer"); server.Parent = SSS
local builder = M.newInstance("ModuleScript", "PlanetBuilder"); builder.Parent = SSS
local spsParent = game:GetService("StarterPlayer")
local sps = M.newInstance("StarterPlayerScripts", "StarterPlayerScripts"); sps.Parent = spsParent
local client = M.newInstance("LocalScript", "TerraClient"); client.Parent = sps

-- сохранение «бывалого» игрока: прошлый заход 2 часа назад
M.stores["TerraRoblox_v1"] = { p_777 = { era = 3, res = { solar = 5000, water = 5000, air = 5000, biomass = 900, science = 0 }, counts = { solar_collector = 20, ice_comet = 10 }, gems = 50, ppr = 0, perks = {}, ppk = {}, stats = {}, lastSave = 1800000000 - 7200 } }

print("Сервер")
M.runScript(server)
M.run(0.5)
noErrors("запуск сервера")
local remotes = RS:FindFirstChild("TerraRemotes")
ok(remotes and remotes:FindFirstChild("Action") and remotes:FindFirstChild("Sync"), "созданы RemoteEvent")
ok(M.players.CharacterAutoLoads == false, "без аватаров")
ok(M.workspace:FindFirstChild("Planets") and M.workspace:FindFirstChild("Asteroids"), "папки планет и астероидов")

print("Игрок заходит")
local player = M.newInstance("Player", "Tester")
player.UserId = 777
player.DisplayName = "Тестер"
local pg = M.newInstance("PlayerGui", "PlayerGui"); pg.Parent = player
player.Parent = M.players
M.players.LocalPlayer = player
M.localPlayer = player
M.players.PlayerAdded:Fire(player)
M.run(1)
M.runScript(client)
M.run(3)
noErrors("вход и запуск клиента")
local planet = M.workspace.Planets:FindFirstChild("Planet_777")
ok(planet ~= nil, "у игрока появилась планета")
ok(planet and planet:FindFirstChild("Spin") and planet.Spin:FindFirstChild("Core"), "у планеты есть шар")
ok(player:FindFirstChild("leaderstats") and player.leaderstats["Эпоха"].Value == 4, "таблица игроков: эпоха 4")
local ui = pg:FindFirstChild("TerraUI")
ok(ui ~= nil, "интерфейс создан")

-- кадры: анимация, камера, обновление HUD
local RunService = game:GetService("RunService")
local function frames(n)
	for _ = 1, n do RunService.RenderStepped:Fire(1 / 30); M.run(1 / 30) end
end
frames(20)
noErrors("кадры")
local cam = M.workspace.CurrentCamera
ok(cam.CameraType == Enum.CameraType.Scriptable, "камера управляется скриптом")
local gemsLabel = M.find(ui, function(x, d) return d.class == "TextLabel" and type(x.Text) == "string" and x.Text == "50" end)
ok(gemsLabel ~= nil, "в шапке 50 кристаллов из сохранения")
local toast = M.find(ui, function(x, d) return d.class == "TextLabel" and type(x.Text) == "string" and string.find(x.Text, "Пока вас не было", 1, true) end)
ok(toast ~= nil, "сообщение о доходе за 2 часа отсутствия")

print("Тапы")
local core = planet.Spin.Core
M.raycastHook = function() return { Instance = core, Position = M.Vector3.new() } end
local UIS = game:GetService("UserInputService")
for _ = 1, 12 do UIS.InputBegan:Fire({ UserInputType = Enum.UserInputType.MouseButton1, Position = M.Vector2.new(640, 380) }, false) end
M.run(0.5)
frames(5)
noErrors("тапы")
local floats = M.findAll(ui, function(x, d) return d.class == "TextLabel" and type(x.Text) == "string" and string.find(x.Text, "+", 1, true) == 1 and string.find(x.Text, "☀", 1, true) ~= nil end)
ok(#floats > 0, "всплывают «+N ☀️»")

print("Вкладки и покупки")
local function clickTab(id)
	local tabs = M.find(ui, function(x, d) return d.name == "Tabs" end)
	tabs[id].Activated:Fire()
	M.run(0.2)
end
local sheet = M.find(ui, function(x, d) return d.name == "Sheet" end)
ok(sheet.Visible == true, "на широком экране панель построек открыта сразу")
local buyButtons = M.findAll(sheet, function(x, d) return d.class == "TextButton" and M.find(x, function(y, dy) return dy.class == "TextLabel" and type(y.Text) == "string" and string.find(y.Text, "Построить", 1, true) == 1 end) ~= nil end)
ok(#buyButtons >= 6, "кнопки покупки построек (открыты по эпохе)", #buyButtons)
local maxBtn = M.find(sheet, function(x, d) return d.class == "TextButton" and x.Text == "MAX" end)
maxBtn.Activated:Fire()
M.run(0.1)
buyButtons[1].Activated:Fire()
M.run(1.2)
frames(3)
noErrors("покупка")
local name1 = M.find(sheet, function(x, d) return d.class == "TextLabel" and type(x.Text) == "string" and string.find(x.Text, "Поглотитель света  ×", 1, true) end)
ok(name1 and tonumber(string.match(name1.Text, "×(%d+)")) > 20, "куплено пачкой MAX", name1 and name1.Text)
for _, t in ipairs({ "perks", "prestige", "top" }) do clickTab(t); frames(2) end
noErrors("вкладки улучшений, престижа и топа")
clickTab("top")
ok(sheet.Visible == false, "повторное нажатие закрывает панель")

print("Эволюция")
local evolveBtn = M.find(ui, function(x, d) return d.class == "TextButton" and (x.Text == "Эволюция" or x.Text == "Максимум") end)
for _ = 1, 3 do evolveBtn.Activated:Fire(); M.run(0.3) end
M.run(1)
frames(3)
noErrors("эволюция")
ok(player.leaderstats["Эпоха"].Value >= 4, "эпоха после эволюции (если хватило ресурсов)", player.leaderstats["Эпоха"].Value)

print("Астероид")
local rock = nil
for _ = 1, 400 do
	M.run(1)
	rock = M.workspace.Asteroids:FindFirstChild("Asteroid")
	if rock then break end
end
frames(3)
noErrors("ожидание астероида")
ok(rock ~= nil and rock:GetAttribute("Owner") == 777, "прилетел астероид")
local banner = M.find(ui, function(x, d) return d.name == "Asteroid" end)
ok(banner and banner.Visible == true, "баннер «АСТЕРОИД! ЖМИ!»")
if rock then
	M.raycastHook = function() return { Instance = rock, Position = M.Vector3.new() } end
	for _ = 1, 20 do
		UIS.InputBegan:Fire({ UserInputType = Enum.UserInputType.Touch, Position = M.Vector2.new(600, 300) }, false)
		M.run(0.2)
	end
	frames(3)
	noErrors("удары по астероиду")
	ok(M.workspace.Asteroids:FindFirstChild("Asteroid") == nil, "астероид уничтожен")
	ok(banner.Visible == false, "баннер скрылся")
end

print("Престиж и сохранение")
M.players.PlayerRemoving:Fire(player)
M.run(1)
noErrors("выход")
local saved = M.stores["TerraRoblox_v1"].p_777
ok(saved and saved.gems > 50 and saved.counts.solar_collector > 20, "прогресс сохранён (кристаллы за астероид, постройки)", saved and saved.gems)
ok(M.stores["ordered:TerraRoblox_Score_v1"]["777"] ~= nil, "очки в мировом топе")
-- готовый к престижу игрок
M.stores["TerraRoblox_v1"].p_777 = { era = 4, res = { solar = 1e6, water = 1e6, air = 1e6, biomass = 1e6, science = 0 }, counts = { solar_collector = 40 }, gems = 0, ppr = 0, lastSave = 1800000000 }
player.leaderstats:Destroy()
M.players.PlayerAdded:Fire(player)
M.run(2)
clickTab("prestige")
frames(2)
local pbtn = M.find(sheet, function(x, d) return d.class == "TextButton" and type(x.Text) == "string" and string.find(x.Text, "Совершить престиж", 1, true) end)
ok(pbtn ~= nil, "кнопка престижа активна")
if pbtn then
	pbtn.Activated:Fire(); M.run(0.1)
	ok(string.find(pbtn.Text, "ещё раз", 1, true) ~= nil, "престиж — с подтверждением")
	pbtn.Activated:Fire(); M.run(1.5)
	frames(3)
end
noErrors("престиж")
ok(player.leaderstats["Престиж"].Value == 1 and player.leaderstats["Эпоха"].Value == 1, "престиж 1, Земля с 1-й эпохи")
local cine = M.find(ui, function(x, d) return d.name == "Cinema" end)
ok(cine ~= nil, "заставка престижа")

print("Экран телефона и закрытие сервера")
cam.ViewportSize = M.Vector2.new(390, 844)
frames(3)
clickTab("build")
frames(3)
noErrors("вертикальный экран")
for _, fn in ipairs(M.closeHandlers) do M.task.spawn(fn) end
M.run(3)
noErrors("закрытие сервера")

print("Studio без доступа к сохранениям")
M.storeFails = true
local p2 = M.newInstance("Player", "Guest"); p2.UserId = 778; p2.DisplayName = "Гость"
local pg2 = M.newInstance("PlayerGui", "PlayerGui"); pg2.Parent = p2
p2.Parent = M.players
M.players.PlayerAdded:Fire(p2)
M.run(3)
noErrors("вход без сохранений")
ok(M.workspace.Planets:FindFirstChild("Planet_778") ~= nil, "играть можно и без сохранений")
ok(#M.warnings > 0, "предупреждение в Output", M.warnings[1])

print(string.format("\nИтого: %d пройдено, %d провалено", pass, fail))
if fail > 0 then error("дымовая проверка не прошла") end
