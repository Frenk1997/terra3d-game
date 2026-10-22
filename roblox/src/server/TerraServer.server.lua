-- Terra 3D для Roblox — сервер: прогресс игроков, экономика, сохранения, астероиды, топ.
-- Сервер решает всё сам (клиент только просит), поэтому накрутить ресурсы с клиента нельзя.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local DataStoreService = game:GetService("DataStoreService")
local RunService = game:GetService("RunService")
local Lighting = game:GetService("Lighting")

local Shared = require(ReplicatedStorage:WaitForChild("TerraShared"))
local Builder = require(script.Parent:WaitForChild("PlanetBuilder"))

Players.CharacterAutoLoads = false   -- без аватаров: только планеты в космосе

-- ---------- космос ----------
Lighting.ClockTime = 0
Lighting.Brightness = 2
Lighting.Ambient = Color3.fromRGB(120, 125, 150)
Lighting.OutdoorAmbient = Color3.fromRGB(120, 125, 150)
Lighting.GlobalShadows = false
Lighting.FogEnd = 100000
if not Lighting:FindFirstChildOfClass("Sky") then
	local sky = Instance.new("Sky")
	sky.StarCount = 5000
	sky.CelestialBodiesShown = false
	sky.Parent = Lighting
end

local planetsFolder = Instance.new("Folder")
planetsFolder.Name = "Planets"
planetsFolder.Parent = workspace
local asteroidsFolder = Instance.new("Folder")
asteroidsFolder.Name = "Asteroids"
asteroidsFolder.Parent = workspace

-- Солнце в центре — для красоты
local sun = Instance.new("Part")
sun.Name = "Sun"
sun.Shape = Enum.PartType.Ball
sun.Size = Vector3.new(60, 60, 60)
sun.Anchored = true
sun.CanCollide = false
sun.CanQuery = false
sun.Material = Enum.Material.Neon
sun.Color = Color3.fromRGB(253, 186, 116)
sun.Position = Vector3.new(0, 0, 0)
sun.Parent = workspace

-- ---------- сеть ----------
local remotes = Instance.new("Folder")
remotes.Name = "TerraRemotes"
local Action = Instance.new("RemoteEvent"); Action.Name = "Action"; Action.Parent = remotes
local Sync = Instance.new("RemoteEvent"); Sync.Name = "Sync"; Sync.Parent = remotes
local Fx = Instance.new("RemoteEvent"); Fx.Name = "Fx"; Fx.Parent = remotes
local Top = Instance.new("RemoteEvent"); Top.Name = "Top"; Top.Parent = remotes
remotes.Parent = ReplicatedStorage

-- ---------- сохранения ----------
local store, scoreStore
local saveOk = pcall(function()
	store = DataStoreService:GetDataStore("TerraRoblox_v1")
	scoreStore = DataStoreService:GetOrderedDataStore("TerraRoblox_Score_v1")
end)

local autoAcc = {}       -- накопленные выстрелы автокликера
local sessions = {}      -- [player] = { st, slot, model, dirty, bucket, asteroid, nextAsteroid, ... }
local SLOTS = 24
local SLOT_RADIUS = 170
local usedSlots = {}

local function slotCenter(i)
	local a = (i - 1) / SLOTS * 2 * math.pi
	return Vector3.new(math.cos(a) * SLOT_RADIUS, ((i % 3) - 1) * 14, math.sin(a) * SLOT_RADIUS)
end
local function takeSlot()
	for i = 1, SLOTS do
		if not usedSlots[i] then usedSlots[i] = true; return i end
	end
	return math.random(1, SLOTS)
end

local function snapshot(s)
	local st = s.st
	return {
		era = st.era, res = st.res, counts = st.counts, gems = st.gems, ppr = st.ppr,
		perks = st.perks, ppk = st.ppk, stats = st.stats,
		slot = s.slot, center = s.center, noSave = s.noSave, t = workspace:GetServerTimeNow(),
	}
end
local function push(player)
	local s = sessions[player]
	if s then Sync:FireClient(player, snapshot(s)) end
end

local function updateStats(player)
	local s = sessions[player]
	if not s then return end
	local ls = player:FindFirstChild("leaderstats")
	if ls then
		ls["Эпоха"].Value = s.st.era + 1
		ls["Престиж"].Value = s.st.ppr
	end
end

local function rebuild(player)
	local s = sessions[player]
	if not s then return end
	if s.model then s.model:Destroy() end
	s.model = Builder.build(player.UserId, player.DisplayName, s.st, s.center)
	s.model.Parent = planetsFolder
	s.builtKey = nil
end
-- планету перестраиваем, только если изменился её вид (эпоха, престиж или набор построек)
local function lookKey(st)
	local ids = {}
	for _, b in ipairs(Shared.BUILDINGS) do
		if (st.counts[b.id] or 0) > 0 then table.insert(ids, b.id) end
	end
	return st.era .. "|" .. st.ppr .. "|" .. table.concat(ids, ",")
end
local function refreshLook(player)
	local s = sessions[player]
	if not s then return end
	local key = lookKey(s.st)
	if key ~= s.lookKey then
		s.lookKey = key
		rebuild(player)
	end
end

local function save(player, final)
	local s = sessions[player]
	if not s or s.noSave or not s.loaded then return end
	s.st.lastSave = os.time()
	local data = s.st
	local ok, err = pcall(function()
		store:SetAsync("p_" .. player.UserId, data)
	end)
	if ok then
		s.dirty = false
		pcall(function() scoreStore:SetAsync(tostring(player.UserId), Shared.score(s.st)) end)
	else
		warn("Terra: не удалось сохранить", player.UserId, err)
	end
	return ok
end

local function load(player)
	if not saveOk then return nil, true end
	local err
	for attempt = 1, 3 do
		local ok, res = pcall(function() return store:GetAsync("p_" .. player.UserId) end)
		if ok then return res, false end
		err = tostring(res)
		-- в Studio без доступа к API или в неопубликованном месте ждать бесполезно
		if string.find(err, "Studio", 1, true) or string.find(err, "403", 1, true) or string.find(err, "publish", 1, true) then break end
		task.wait(1.5 * attempt)
	end
	warn("Terra: сохранения недоступны —", err)
	return nil, true
end

-- ---------- астероиды ----------
local asteroidSeq = 0
local function scheduleAsteroid(s, first)
	local range = first and Shared.ASTEROID_FIRST or Shared.ASTEROID_NEXT
	s.nextAsteroid = os.clock() + range[1] + math.random() * (range[2] - range[1])
end
local function endAsteroid(player, destroyed)
	local s = sessions[player]
	if not s or not s.asteroid then return end
	local a = s.asteroid
	s.asteroid = nil
	if a.part then a.part:Destroy() end
	scheduleAsteroid(s, false)
	if destroyed then
		local gems, bonus = Shared.asteroidReward(s.st, a.golden)
		s.st.gems = s.st.gems + gems
		s.st.res.solar = s.st.res.solar + bonus
		s.st.stats.asteroids = s.st.stats.asteroids + 1
		if a.golden then s.st.stats.golden = s.st.stats.golden + 1 end
		s.dirty = true
		Fx:FireClient(player, "asteroidDone", { gems = gems, bonus = bonus, golden = a.golden })
		push(player)
	else
		Fx:FireClient(player, "asteroidMiss", {})
	end
end
local function spawnAsteroid(player)
	local s = sessions[player]
	if not s or s.asteroid then return end
	asteroidSeq = asteroidSeq + 1
	local golden = math.random() < Shared.GOLDEN_CHANCE
	local hp = Shared.asteroidHp(s.st, golden)
	-- летит из-за спины камеры игрока к планете
	local out = Vector3.new(s.center.X, 0, s.center.Z).Unit
	local side = Vector3.new(-out.Z, 0, out.X) * (math.random() < 0.5 and -1 or 1)
	local from = s.center + out * 30 + side * 26 + Vector3.new(0, 18, 0)
	local to = s.center + out * 13 + side * 3 + Vector3.new(0, 4, 0)
	local p = Instance.new("Part")
	p.Name = "Asteroid"
	p.Shape = Enum.PartType.Ball
	p.Size = golden and Vector3.new(3.4, 3.4, 3.4) or Vector3.new(3.8, 3.8, 3.8)
	p.Anchored = true
	p.CanCollide = false
	p.CanTouch = false
	p.Material = golden and Enum.Material.Neon or Enum.Material.Slate
	p.Color = golden and Color3.fromRGB(250, 204, 21) or Color3.fromRGB(120, 113, 108)
	p.Position = from
	p:SetAttribute("Id", asteroidSeq)
	p:SetAttribute("Owner", player.UserId)
	p:SetAttribute("Golden", golden)
	p:SetAttribute("From", from)
	p:SetAttribute("To", to)
	p:SetAttribute("T0", workspace:GetServerTimeNow())
	p:SetAttribute("Dur", Shared.ASTEROID_FLIGHT)
	p.Parent = asteroidsFolder
	s.asteroid = { id = asteroidSeq, hp = hp, maxHp = hp, golden = golden, part = p, deadline = os.clock() + Shared.ASTEROID_FLIGHT }
	Fx:FireClient(player, "asteroid", { id = asteroidSeq, golden = golden, hp = hp, maxHp = hp, dur = Shared.ASTEROID_FLIGHT })
end
local function hitAsteroid(player, id, shots)
	local s = sessions[player]
	if not s or not s.asteroid or s.asteroid.id ~= id then return end
	local a = s.asteroid
	local g = Shared.clickGain(s.st, false)
	for _ = 1, shots do
		a.hp = a.hp - g * Shared.critMult(s.st, math.random())
	end
	if a.hp <= 0 then endAsteroid(player, true)
	else Fx:FireClient(player, "asteroidHp", { id = id, hp = a.hp, maxHp = a.maxHp }) end
end

-- ---------- игроки ----------
local function onJoin(player)
	local ls = Instance.new("Folder")
	ls.Name = "leaderstats"
	local e = Instance.new("IntValue"); e.Name = "Эпоха"; e.Value = 1; e.Parent = ls
	local p = Instance.new("IntValue"); p.Name = "Престиж"; p.Value = 0; p.Parent = ls
	ls.Parent = player

	local raw, noSave = load(player)
	if not player.Parent then return end
	local st = Shared.sanitize(raw)
	local slot = takeSlot()
	local s = { st = st, slot = slot, center = slotCenter(slot), noSave = noSave, loaded = true, dirty = false,
		bucket = 30, bucketAt = os.clock(), boostUntil = 0 }
	sessions[player] = s
	-- доход, пока игрока не было (до 8 часов, вполсилы)
	local offline = 0
	if raw and st.lastSave > 0 then
		local away = os.time() - st.lastSave
		offline = Shared.offline(st, away)
		if offline > 0 then
			s.dirty = true
			task.delay(2, function()
				Fx:FireClient(player, "offline", { sec = math.min(away, Shared.OFFLINE_MAX_SEC), gain = offline })
			end)
		end
	end
	scheduleAsteroid(s, true)
	refreshLook(player)
	updateStats(player)
	push(player)
	if noSave and RunService:IsStudio() then
		Fx:FireClient(player, "toast", { text = "⚠️ Сохранения выключены: в Studio включите Game Settings → Security → Enable Studio Access to API Services" })
	elseif noSave then
		Fx:FireClient(player, "toast", { text = "⚠️ Сервер сохранений Roblox не ответил — прогресс этой игры может не сохраниться" })
	end
end

local function onLeave(player)
	local s = sessions[player]
	if not s then return end
	save(player, true)
	if s.asteroid and s.asteroid.part then s.asteroid.part:Destroy() end
	if s.model then s.model:Destroy() end
	usedSlots[s.slot] = nil
	sessions[player] = nil
	autoAcc[player] = nil
end

Players.PlayerAdded:Connect(onJoin)
Players.PlayerRemoving:Connect(onLeave)
for _, pl in ipairs(Players:GetPlayers()) do task.spawn(onJoin, pl) end

game:BindToClose(function()
	local left = 0
	for pl in pairs(sessions) do
		left = left + 1
		task.spawn(function() save(pl, true); left = left - 1 end)
	end
	local t0 = os.clock()
	while left > 0 and os.clock() - t0 < 20 do task.wait(0.2) end
end)

-- ---------- действия игрока ----------
local MODES = { [1] = 1, [10] = 10, [50] = 50, [100] = 100, max = "max" }
Action.OnServerEvent:Connect(function(player, kind, a, b)
	local s = sessions[player]
	if not s or type(kind) ~= "string" then return end
	local st = s.st
	if kind == "tap" then
		-- не больше ~15 тапов в секунду (с запасом 30) — быстрее человек не тапает
		local now = os.clock()
		s.bucket = math.min(30, s.bucket + (now - s.bucketAt) * 15)
		s.bucketAt = now
		local n = math.floor(tonumber(a) or 0)
		n = math.min(n, math.floor(s.bucket))
		if n <= 0 then return end
		s.bucket = s.bucket - n
		local rolls = {}
		for i = 1, n do rolls[i] = math.random() end
		Shared.tap(st, n, rolls)
		s.dirty = true
	elseif kind == "hit" then
		local now = os.clock()
		s.bucket = math.min(30, s.bucket + (now - s.bucketAt) * 15)
		s.bucketAt = now
		local n = math.min(math.floor(tonumber(b) or 0), math.floor(s.bucket))
		if n <= 0 then return end
		s.bucket = s.bucket - n
		hitAsteroid(player, tonumber(a), n)
	elseif kind == "buy" then
		local mode = MODES[b] or 1
		local ok, res = Shared.buy(st, tostring(a), mode)
		if ok then
			s.dirty = true
			refreshLook(player)
			Fx:FireClient(player, "bought", { id = a, n = res })
		end
		push(player)
	elseif kind == "evolve" then
		local ok = Shared.evolve(st)
		if ok then
			s.dirty = true
			refreshLook(player)
			updateStats(player)
			Fx:FireClient(player, "evolve", { era = st.era })
			task.spawn(save, player)
		end
		push(player)
	elseif kind == "prestige" then
		local ok, gems = Shared.prestige(st)
		if ok then
			s.dirty = true
			endAsteroid(player, false)
			refreshLook(player)
			updateStats(player)
			Fx:FireClient(player, "prestige", { n = st.ppr, gems = gems })
			task.spawn(save, player)
		end
		push(player)
	elseif kind == "perk" then
		if Shared.buyPerk(st, tostring(a)) then s.dirty = true end
		push(player)
	elseif kind == "gperk" then
		if Shared.buyGlobal(st, tostring(a)) then s.dirty = true end
		push(player)
	end
end)

-- ---------- игровой цикл: доход, автокликер, астероиды ----------
local last = os.clock()
task.spawn(function()
	while true do
		task.wait(1)
		local now = os.clock()
		local dt = math.min(5, now - last)
		last = now
		for player, s in pairs(sessions) do
			local st = s.st
			Shared.tick(st, dt, false)
			st.stats.playSec = st.stats.playSec + dt
			-- автокликер: 2 выстрела в секунду за уровень — по астероиду, если он есть, иначе по планете
			local lvl = Shared.perk(st, "autoclicker")
			if lvl > 0 then
				local acc = (autoAcc[player] or 0) + lvl * 2 * dt
				local shots = math.floor(acc)
				autoAcc[player] = acc - shots
				if shots > 0 then
					if s.asteroid then hitAsteroid(player, s.asteroid.id, shots)
					else Shared.tap(st, shots, nil); st.stats.taps = st.stats.taps - shots end
				end
			end
			if s.asteroid and now >= s.asteroid.deadline then endAsteroid(player, false)
			elseif not s.asteroid and s.nextAsteroid and now >= s.nextAsteroid then spawnAsteroid(player) end
			s.dirty = true
			push(player)
		end
	end
end)

-- автосохранение раз в минуту
task.spawn(function()
	while true do
		task.wait(60)
		for player, s in pairs(sessions) do
			if s.dirty then task.spawn(save, player) end
		end
	end
end)

-- мировой топ (раз в минуту)
local nameCache = {}
local function nameOf(userId)
	if nameCache[userId] then return nameCache[userId] end
	local ok, name = pcall(function() return Players:GetNameFromUserIdAsync(userId) end)
	if ok and name then nameCache[userId] = name; return name end
	return "Игрок " .. userId
end
local lastTop = {}
local function refreshTop()
	if not saveOk then return end
	local ok, pages = pcall(function() return scoreStore:GetSortedAsync(false, 20) end)
	if not ok or not pages then return end
	local list = {}
	for rank, item in ipairs(pages:GetCurrentPage()) do
		local id = tonumber(item.key)
		table.insert(list, { rank = rank, name = id and nameOf(id) or tostring(item.key), score = item.value, me = id })
	end
	lastTop = list
	Top:FireAllClients(list)
end
task.spawn(function()
	task.wait(5)
	while true do
		refreshTop()
		task.wait(60)
	end
end)
Players.PlayerAdded:Connect(function(player)
	task.wait(3)
	if player.Parent then Top:FireClient(player, lastTop) end
end)
