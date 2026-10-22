-- Строит 3D-планету игрока по его эпохе и постройкам (сервер, видят все игроки).
-- Структура модели (клиент вращает части по именам):
--   Spin   — шар, материки, огни, значки построек (вращается вокруг оси)
--   Clouds — облака (вращаются чуть быстрее)
--   Orbit  — луна, спутники, рой Дайсона, врата (вращаются по орбите)
--   Static — атмосфера, сияние, кольцо, луч маяка, табличка с ником
local Shared = require(game:GetService("ReplicatedStorage"):WaitForChild("TerraShared"))

local Builder = {}
Builder.RADIUS = 12

local function rgb(t) return Color3.fromRGB(t[1], t[2], t[3]) end

local function ball(parent, name, cf, diameter, color, material, transparency)
	local p = Instance.new("Part")
	p.Name = name
	p.Shape = Enum.PartType.Ball
	p.Size = Vector3.new(diameter, diameter, diameter)
	p.CFrame = cf
	p.Anchored = true
	p.CanCollide = false
	p.CanTouch = false
	p.CastShadow = false
	p.Material = material or Enum.Material.SmoothPlastic
	p.Color = color
	p.Transparency = transparency or 0
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = parent
	return p
end

local function block(parent, name, cf, size, color, material, transparency)
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size
	p.CFrame = cf
	p.Anchored = true
	p.CanCollide = false
	p.CanTouch = false
	p.CastShadow = false
	p.Material = material or Enum.Material.SmoothPlastic
	p.Color = color
	p.Transparency = transparency or 0
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = parent
	return p
end

-- Точки на сфере, равномерно (золотой угол); seed сдвигает узор
local function sphereDir(i, n, seed)
	local y = 1 - 2 * (i - 0.5) / n
	local r = math.sqrt(math.max(0, 1 - y * y))
	local phi = i * 2.399963 + seed
	return Vector3.new(math.cos(phi) * r, y, math.sin(phi) * r)
end

-- Пятно на поверхности: шар, который выступает над планетой на h
local function patch(parent, center, R, dir, r, h, color, material, transparency)
	return ball(parent, "Patch", CFrame.new(center + dir.Unit * (R + h - r)), r * 2, color, material, transparency)
end

-- Кольцо из отрезков в плоскости XZ локальной системы cf
local function ring(parent, cf, radius, count, width, thickness, color, material, transparency)
	local seg = 2 * math.pi * radius / count * 1.08
	for i = 1, count do
		local a = (i / count) * 2 * math.pi
		local p = Vector3.new(math.cos(a) * radius, 0, math.sin(a) * radius)
		local t = Vector3.new(-math.sin(a), 0, math.cos(a))
		block(parent, "Ring", cf * CFrame.lookAt(p, p + t), Vector3.new(width, thickness, seg), color, material, transparency)
	end
end

-- Как выглядит Земля в каждой эпохе
local LOOK = {
	[0] = { base = { 205, 82, 30 }, mat = Enum.Material.CrackedLava, patches = { { { 58, 30, 24 }, Enum.Material.Basalt, 9 } }, clouds = 0, atmo = nil },
	[1] = { base = { 22, 78, 170 }, mat = Enum.Material.Glass, patches = { { { 92, 64, 51 }, Enum.Material.Basalt, 6 } }, clouds = 4, cloud = { 160, 160, 170 }, atmo = { 56, 189, 248 } },
	[2] = { base = { 25, 95, 190 }, mat = Enum.Material.Glass, patches = { { { 110, 80, 60 }, Enum.Material.Rock, 6 } }, clouds = 9, atmo = { 125, 211, 252 } },
	[3] = { base = { 25, 105, 185 }, mat = Enum.Material.Glass, patches = { { { 110, 80, 60 }, Enum.Material.Rock, 6 }, { { 45, 212, 191 }, Enum.Material.SmoothPlastic, 7, 0.35 } }, clouds = 9, atmo = { 125, 211, 252 } },
	[4] = { base = { 30, 110, 200 }, mat = Enum.Material.Glass, patches = { { { 76, 175, 80 }, Enum.Material.Grass, 8 } }, clouds = 10, atmo = { 147, 197, 253 } },
	[5] = { base = { 30, 110, 200 }, mat = Enum.Material.Glass, patches = { { { 54, 140, 60 }, Enum.Material.Grass, 8 }, { { 22, 101, 52 }, Enum.Material.LeafyGrass, 10 } }, clouds = 10, atmo = { 147, 197, 253 } },
	[6] = { base = { 30, 110, 200 }, mat = Enum.Material.Glass, patches = { { { 76, 160, 70 }, Enum.Material.Grass, 8 }, { { 161, 98, 7 }, Enum.Material.Sand, 6 } }, clouds = 10, atmo = { 147, 197, 253 } },
	[7] = { base = { 35, 100, 180 }, mat = Enum.Material.Glass, patches = { { { 76, 150, 70 }, Enum.Material.Grass, 8 }, { { 120, 120, 125 }, Enum.Material.Concrete, 8 } }, clouds = 10, cloud = { 190, 180, 160 }, atmo = { 203, 213, 225 } },
}
local function lookFor(era)
	if era <= 7 then return LOOK[era] end
	return { base = { 30, 105, 200 }, mat = Enum.Material.Glass, patches = { { { 70, 160, 80 }, Enum.Material.Grass, 8 }, { { 148, 163, 184 }, Enum.Material.Concrete, 7 } }, clouds = 9, atmo = { 165, 180, 252 } }
end

function Builder.build(userId, displayName, st, center)
	local R = Builder.RADIUS
	local era = st.era
	local E = Shared.ERAS[era + 1]
	local L = lookFor(era)
	local halo = rgb(E.halo)
	local seed = (userId % 997) / 97

	local model = Instance.new("Model")
	model.Name = "Planet_" .. userId
	model:SetAttribute("Owner", userId)
	model:SetAttribute("Era", era)
	local spin = Instance.new("Model"); spin.Name = "Spin"; spin.Parent = model
	local clouds = Instance.new("Model"); clouds.Name = "Clouds"; clouds.Parent = model
	local orbit = Instance.new("Model"); orbit.Name = "Orbit"; orbit.Parent = model
	local static = Instance.new("Model"); static.Name = "Static"; static.Parent = model

	-- шар и поверхность
	local core = ball(spin, "Core", CFrame.new(center), R * 2, rgb(L.base), L.mat)
	if L.mat == Enum.Material.Glass then core.Reflectance = 0.08 end
	local k = 0
	for gi, grp in ipairs(L.patches) do
		local n = grp[3]
		for i = 1, n do
			k = k + 1
			local dir = sphereDir(i, n, seed + gi * 1.7)
			local r = R * (0.32 + ((i * 37 + gi * 11) % 10) / 45)
			patch(spin, center, R, dir, r, R * 0.035, rgb(grp[1]), grp[2], grp[4] or 0)
		end
	end
	-- огни городов и сеть ИИ
	if era >= 9 then
		for i = 1, 36 do
			local dir = sphereDir(i, 36, seed + 0.9)
			ball(spin, "Light", CFrame.new(center + dir * (R * 1.04)), 0.45, Color3.fromRGB(253, 224, 71), Enum.Material.Neon)
		end
	end
	if era >= 11 then
		for i = 1, 24 do
			local dir = sphereDir(i, 24, seed + 2.3)
			ball(spin, "Node", CFrame.new(center + dir * (R * 1.05)), 0.55, Color3.fromRGB(34, 211, 238), Enum.Material.Neon)
		end
	end
	-- значки построек
	local nb = #Shared.BUILDINGS
	for i, b in ipairs(Shared.BUILDINGS) do
		if (st.counts[b.id] or 0) > 0 then
			local dir = sphereDir(i, nb, seed + 4.1)
			local anchor = block(spin, "Marker", CFrame.new(center + dir * (R * 1.06)), Vector3.new(0.2, 0.2, 0.2), Color3.new(1, 1, 1), Enum.Material.SmoothPlastic, 1)
			anchor.CanQuery = false
			local gui = Instance.new("BillboardGui")
			gui.Size = UDim2.new(3.4, 0, 3.4, 0)
			gui.LightInfluence = 0
			gui.MaxDistance = 140
			gui.Parent = anchor
			local t = Instance.new("TextLabel")
			t.BackgroundTransparency = 1
			t.Size = UDim2.new(1, 0, 1, 0)
			t.Text = b.icon
			t.TextScaled = true
			t.Font = Enum.Font.GothamBold
			t.TextColor3 = Color3.new(1, 1, 1)
			t.Parent = gui
		end
	end

	-- облака
	for i = 1, L.clouds do
		local dir = sphereDir(i, L.clouds, seed + 3.3)
		dir = Vector3.new(dir.X, dir.Y * 0.8, dir.Z)
		local r = R * (0.2 + (i % 4) * 0.04)
		patch(clouds, center, R, dir, r, R * 0.1, rgb(L.cloud or { 255, 255, 255 }), Enum.Material.SmoothPlastic, 0.2)
	end

	-- атмосфера и сияние эпохи
	if L.atmo then
		local a = ball(static, "Atmosphere", CFrame.new(center), R * 2.14, rgb(L.atmo), Enum.Material.Neon, 0.88)
		a.CanQuery = false
	end
	local glow = ball(static, "Glow", CFrame.new(center), R * 2.45, halo, Enum.Material.Neon, 0.94)
	glow.CanQuery = false
	local light = Instance.new("PointLight")
	light.Color = halo
	light.Brightness = 1.5
	light.Range = 40
	light.Parent = glow

	-- луна
	local moon = ball(orbit, "Moon", CFrame.new(center + Vector3.new(R * 2.6, R * 0.25, 0)), R * 0.36, Color3.fromRGB(190, 190, 196), Enum.Material.Slate)
	moon.CanQuery = false
	-- спутники
	if era >= 8 then
		for i = 1, 3 do
			local a = i * 2.1
			local p = center + Vector3.new(math.cos(a) * R * 1.55, (i - 2) * R * 0.35, math.sin(a) * R * 1.55)
			local body = block(orbit, "Satellite", CFrame.new(p), Vector3.new(0.9, 0.9, 0.9), Color3.fromRGB(226, 232, 240), Enum.Material.Metal)
			body.CanQuery = false
			local panel = block(orbit, "Panel", CFrame.new(p), Vector3.new(3.2, 0.12, 0.9), Color3.fromRGB(59, 130, 246), Enum.Material.Glass)
			panel.CanQuery = false
		end
	end
	-- рой Дайсона
	if era >= 9 then
		for i = 1, 18 do
			local dir = sphereDir(i, 18, seed + 5.5)
			local p = block(orbit, "Swarm", CFrame.new(center + dir * (R * 1.9)), Vector3.new(0.7, 0.08, 0.7), Color3.fromRGB(250, 204, 21), Enum.Material.Neon)
			p.CanQuery = false
		end
	end
	-- орбитальное кольцо
	if era >= 10 then
		ring(static, CFrame.new(center) * CFrame.Angles(math.rad(14), 0, math.rad(6)), R * 1.75, 56, R * 0.22, 0.18, Color3.fromRGB(148, 163, 184), Enum.Material.Metal, 0)
	end
	-- звёздные врата
	if era >= 12 then
		local gcf = CFrame.new(center + Vector3.new(-R * 2.7, R * 0.9, 0)) * CFrame.Angles(math.pi / 2, 0, math.rad(25))
		ring(orbit, gcf, R * 0.55, 28, 0.6, 0.6, Color3.fromRGB(167, 139, 250), Enum.Material.Neon, 0)
	end
	-- вторая аура держав
	if era >= 13 then
		local g2 = ball(static, "Glow2", CFrame.new(center), R * 2.9, Color3.fromRGB(244, 114, 182), Enum.Material.Neon, 0.96)
		g2.CanQuery = false
	end
	-- галактический маяк
	if era >= 14 then
		local beam = block(static, "Beacon", CFrame.new(center + Vector3.new(0, R + 32, 0)) * CFrame.Angles(0, 0, math.pi / 2), Vector3.new(64, 1.4, 1.4), Color3.fromRGB(254, 240, 138), Enum.Material.Neon, 0.3)
		beam.Shape = Enum.PartType.Cylinder
		beam.CanQuery = false
	end

	-- табличка с ником (своему игроку клиент её скрывает)
	local tagPart = block(static, "Tag", CFrame.new(center + Vector3.new(0, R * 1.55, 0)), Vector3.new(0.2, 0.2, 0.2), Color3.new(1, 1, 1), Enum.Material.SmoothPlastic, 1)
	tagPart.CanQuery = false
	local tag = Instance.new("BillboardGui")
	tag.Name = "NameTag"
	tag.Size = UDim2.new(0, 220, 0, 46)
	tag.StudsOffset = Vector3.new(0, 2, 0)
	tag.AlwaysOnTop = true
	tag.LightInfluence = 0
	tag.MaxDistance = 600
	tag.Parent = tagPart
	local name = Instance.new("TextLabel")
	name.BackgroundTransparency = 1
	name.Size = UDim2.new(1, 0, 0.55, 0)
	name.Text = displayName
	name.TextScaled = true
	name.Font = Enum.Font.GothamBold
	name.TextColor3 = Color3.new(1, 1, 1)
	name.TextStrokeTransparency = 0.5
	name.Parent = tag
	local sub = Instance.new("TextLabel")
	sub.BackgroundTransparency = 1
	sub.Position = UDim2.new(0, 0, 0.55, 0)
	sub.Size = UDim2.new(1, 0, 0.45, 0)
	sub.Text = "Эпоха " .. (era + 1) .. (st.ppr > 0 and ("  ·  🌀 " .. st.ppr) or "")
	sub.TextScaled = true
	sub.Font = Enum.Font.Gotham
	sub.TextColor3 = rgb(E.halo)
	sub.TextStrokeTransparency = 0.6
	sub.Parent = tag

	for _, m in ipairs({ spin, clouds, orbit, static }) do m.WorldPivot = CFrame.new(center) end
	model.WorldPivot = CFrame.new(center)
	return model
end

return Builder
