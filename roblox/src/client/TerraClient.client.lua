-- Terra 3D для Roblox — клиент: камера, тапы, анимация планет и весь интерфейс.
-- Клиент только показывает и просит сервер; все расчёты делает сервер (TerraServer).
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local TweenService = game:GetService("TweenService")
local GuiService = game:GetService("GuiService")

local player = Players.LocalPlayer
local Shared = require(ReplicatedStorage:WaitForChild("TerraShared"))
local remotes = ReplicatedStorage:WaitForChild("TerraRemotes")
local Action = remotes:WaitForChild("Action")
local Sync = remotes:WaitForChild("Sync")
local Fx = remotes:WaitForChild("Fx")
local Top = remotes:WaitForChild("Top")
local camera = workspace.CurrentCamera
local planetsFolder = workspace:WaitForChild("Planets")
local asteroidsFolder = workspace:WaitForChild("Asteroids")

-- ============================================================
--  Оформление
-- ============================================================
local C = {
	panel = Color3.fromRGB(12, 18, 40),
	card = Color3.fromRGB(24, 32, 64),
	card2 = Color3.fromRGB(34, 44, 84),
	stroke = Color3.fromRGB(110, 130, 220),
	text = Color3.fromRGB(244, 247, 255),
	dim = Color3.fromRGB(160, 172, 214),
	faint = Color3.fromRGB(110, 120, 160),
	accent = Color3.fromRGB(91, 140, 255),
	good = Color3.fromRGB(34, 197, 94),
	bad = Color3.fromRGB(248, 113, 113),
	gold = Color3.fromRGB(250, 204, 21),
	violet = Color3.fromRGB(167, 139, 250),
}
local BOLD, MED = Enum.Font.GothamBold, Enum.Font.GothamMedium

local function new(class, props, children)
	local o = Instance.new(class)
	local parent = props.Parent
	props.Parent = nil
	for k, v in pairs(props) do o[k] = v end
	if children then
		for _, c in ipairs(children) do c.Parent = o end
	end
	if parent then o.Parent = parent end
	return o
end
local function corner(r) return new("UICorner", { CornerRadius = UDim.new(0, r) }) end
local function stroke(color, th, tr) return new("UIStroke", { Color = color, Thickness = th or 1, Transparency = tr or 0.6, ApplyStrokeMode = Enum.ApplyStrokeMode.Border }) end
local function padding(l, t, r, b) return new("UIPadding", { PaddingLeft = UDim.new(0, l), PaddingTop = UDim.new(0, t or l), PaddingRight = UDim.new(0, r or l), PaddingBottom = UDim.new(0, b or t or l) }) end
local function label(props)
	props.BackgroundTransparency = 1
	props.TextColor3 = props.TextColor3 or C.text
	props.Font = props.Font or MED
	props.TextSize = props.TextSize or 14
	props.TextXAlignment = props.TextXAlignment or Enum.TextXAlignment.Left
	return new("TextLabel", props)
end
local function button(props, color)
	props.AutoButtonColor = true
	props.BackgroundColor3 = color or C.accent
	props.TextColor3 = props.TextColor3 or C.text
	props.Font = props.Font or BOLD
	props.TextSize = props.TextSize or 15
	local b = new("TextButton", props)
	corner(12).Parent = b
	return b
end
local function rgb(t) return Color3.fromRGB(t[1], t[2], t[3]) end
local fmt = Shared.fmt

-- ============================================================
--  Каркас интерфейса
-- ============================================================
local playerGui = player:WaitForChild("PlayerGui")
-- на телефонах и планшетах — вертикальный экран, как в основной игре (планета сверху, меню снизу)
if UserInputService.TouchEnabled and not UserInputService.KeyboardEnabled then
	playerGui.ScreenOrientation = Enum.ScreenOrientation.Portrait
end
local gui = new("ScreenGui", { Name = "TerraUI", ResetOnSpawn = false, IgnoreGuiInset = false, ZIndexBehavior = Enum.ZIndexBehavior.Sibling, Parent = playerGui })
local root = new("Frame", { Name = "Root", BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), Parent = gui })
local uiScale = new("UIScale", { Parent = root })
local SCALE, W, H, WIDE = 1, 400, 800, false

-- верхняя панель ресурсов
local top = new("Frame", { Name = "Top", BackgroundColor3 = C.panel, BackgroundTransparency = 0.15, Size = UDim2.fromOffset(380, 54), AnchorPoint = Vector2.new(0.5, 0), Parent = root }, { corner(16), stroke(C.stroke, 1, 0.7) })
local pills = {}
local PILL_KEYS = { "solar", "water", "air", "biomass", "science", "gems" }
for i, k in ipairs(PILL_KEYS) do
	local R = Shared.RES[k]
	local f = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1 / 6, 0, 1, 0), Position = UDim2.new((i - 1) / 6, 0, 0, 0), Parent = top })
	label({ Text = R.icon, TextSize = 18, Size = UDim2.new(0, 22, 1, 0), Position = UDim2.fromOffset(4, 0), TextXAlignment = Enum.TextXAlignment.Center, Parent = f })
	local v = label({ Text = "0", Font = BOLD, TextSize = 14, Size = UDim2.new(1, -28, 0, 20), Position = UDim2.fromOffset(27, 8), TextTruncate = Enum.TextTruncate.AtEnd, Parent = f })
	local r = label({ Text = R.name, TextSize = 10, TextColor3 = C.dim, Size = UDim2.new(1, -28, 0, 14), Position = UDim2.fromOffset(27, 28), TextTruncate = Enum.TextTruncate.AtEnd, Parent = f })
	pills[k] = { value = v, rate = r }
end
local info = label({ Name = "Info", Text = "", TextSize = 13, TextColor3 = C.dim, AnchorPoint = Vector2.new(0.5, 0), TextXAlignment = Enum.TextXAlignment.Center, Size = UDim2.fromOffset(380, 18), Parent = root })
local warnLabel = label({ Name = "Warn", Text = "", TextSize = 12, TextColor3 = C.bad, AnchorPoint = Vector2.new(0.5, 0), TextXAlignment = Enum.TextXAlignment.Center, TextWrapped = true, Size = UDim2.fromOffset(380, 30), Visible = false, Parent = root })

-- баннер астероида
local banner = new("Frame", { Name = "Asteroid", BackgroundColor3 = Color3.fromRGB(120, 30, 20), BackgroundTransparency = 0.1, AnchorPoint = Vector2.new(0.5, 0), Size = UDim2.fromOffset(300, 46), Visible = false, Parent = root }, { corner(14), stroke(Color3.fromRGB(251, 146, 60), 1.5, 0.2) })
local bannerText = label({ Text = "☄️ АСТЕРОИД! ЖМИ НА НЕГО!", Font = BOLD, TextSize = 14, TextXAlignment = Enum.TextXAlignment.Center, Size = UDim2.new(1, 0, 0, 24), Position = UDim2.fromOffset(0, 4), Parent = banner })
local bannerBarBg = new("Frame", { BackgroundColor3 = Color3.fromRGB(40, 10, 8), Size = UDim2.new(1, -24, 0, 8), Position = UDim2.fromOffset(12, 31), Parent = banner }, { corner(4) })
local bannerBar = new("Frame", { BackgroundColor3 = Color3.fromRGB(251, 146, 60), Size = UDim2.fromScale(1, 1), Parent = bannerBarBg }, { corner(4) })

-- карточка эпохи
local eraCard = new("Frame", { Name = "Era", BackgroundColor3 = C.panel, BackgroundTransparency = 0.12, AnchorPoint = Vector2.new(0.5, 1), Size = UDim2.fromOffset(380, 92), Parent = root }, { corner(16), stroke(C.stroke, 1, 0.65) })
local eraKicker = label({ Text = "ЭПОХА 1", Font = BOLD, TextSize = 11, TextColor3 = Color3.fromRGB(20, 20, 30), TextXAlignment = Enum.TextXAlignment.Center, Size = UDim2.fromOffset(74, 18), Position = UDim2.fromOffset(12, 10), BackgroundTransparency = 0, Parent = eraCard })
eraKicker.BackgroundTransparency = 0
eraKicker.BackgroundColor3 = C.gold
corner(9).Parent = eraKicker
local eraName = label({ Text = "Протопланета", Font = BOLD, TextSize = 17, Size = UDim2.new(1, -230, 0, 20), Position = UDim2.fromOffset(94, 9), TextTruncate = Enum.TextTruncate.AtEnd, Parent = eraCard })
local eraNext = label({ Text = "", TextSize = 12, TextColor3 = C.dim, Size = UDim2.new(1, -150, 0, 32), Position = UDim2.fromOffset(12, 32), TextWrapped = true, TextYAlignment = Enum.TextYAlignment.Top, Parent = eraCard })
local eraBarBg = new("Frame", { BackgroundColor3 = Color3.fromRGB(30, 38, 70), Size = UDim2.new(1, -24, 0, 7), Position = UDim2.new(0, 12, 1, -16), Parent = eraCard }, { corner(4) })
local eraBar = new("Frame", { BackgroundColor3 = C.good, Size = UDim2.fromScale(0, 1), Parent = eraBarBg }, { corner(4) })
local evolveBtn = button({ Text = "Эволюция", Size = UDim2.fromOffset(124, 44), AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -12, 0, 12) }, C.card2)
evolveBtn.Parent = eraCard

-- меню вкладок
local tabsBar = new("Frame", { Name = "Tabs", BackgroundColor3 = C.panel, BackgroundTransparency = 0.12, AnchorPoint = Vector2.new(0.5, 1), Size = UDim2.fromOffset(380, 60), Parent = root }, { corner(18), stroke(C.stroke, 1, 0.65) })
local TABS = {
	{ id = "build", icon = "🏗️", label = "Постройки" },
	{ id = "perks", icon = "🌳", label = "Улучшения" },
	{ id = "prestige", icon = "🌀", label = "Престиж" },
	{ id = "top", icon = "🏆", label = "Топ" },
}
local tabButtons = {}
for i, t in ipairs(TABS) do
	local b = new("TextButton", { Name = t.id, Text = "", AutoButtonColor = false, BackgroundColor3 = C.accent, BackgroundTransparency = 1, Size = UDim2.new(0.25, -6, 1, -8), Position = UDim2.new((i - 1) * 0.25, 3, 0, 4), Parent = tabsBar }, { corner(14) })
	label({ Text = t.icon, TextSize = 20, TextXAlignment = Enum.TextXAlignment.Center, Size = UDim2.new(1, 0, 0, 26), Position = UDim2.fromOffset(0, 4), Parent = b })
	label({ Text = t.label, Font = BOLD, TextSize = 11, TextColor3 = C.dim, TextXAlignment = Enum.TextXAlignment.Center, Size = UDim2.new(1, 0, 0, 16), Position = UDim2.fromOffset(0, 32), Parent = b })
	local dot = new("Frame", { Name = "Dot", BackgroundColor3 = C.gold, Size = UDim2.fromOffset(8, 8), Position = UDim2.new(0.5, 14, 0, 4), Visible = false, Parent = b }, { corner(4) })
	tabButtons[t.id] = { btn = b, dot = dot }
end

-- выезжающая панель
local sheet = new("Frame", { Name = "Sheet", BackgroundColor3 = C.panel, BackgroundTransparency = 0.04, Size = UDim2.fromOffset(380, 400), Visible = false, ClipsDescendants = true, Parent = root }, { corner(18), stroke(C.stroke, 1, 0.55) })
local sheetTitle = label({ Text = "", Font = BOLD, TextSize = 17, Size = UDim2.new(1, -60, 0, 44), Position = UDim2.fromOffset(16, 2), Parent = sheet })
local sheetClose = button({ Text = "✕", TextSize = 16, Size = UDim2.fromOffset(36, 36), AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -8, 0, 6) }, C.card2)
sheetClose.Parent = sheet
local scroll = new("ScrollingFrame", { BackgroundTransparency = 1, BorderSizePixel = 0, Size = UDim2.new(1, -12, 1, -50), Position = UDim2.fromOffset(6, 46), CanvasSize = UDim2.new(), AutomaticCanvasSize = Enum.AutomaticSize.Y, ScrollingDirection = Enum.ScrollingDirection.Y, ScrollBarThickness = 4, ScrollBarImageColor3 = C.stroke, Parent = sheet })
new("UIListLayout", { Padding = UDim.new(0, 7), SortOrder = Enum.SortOrder.LayoutOrder, Parent = scroll })
padding(4, 2, 8, 12).Parent = scroll

-- всплывающие сообщения и заставка новой эпохи
local toastHolder = new("Frame", { BackgroundTransparency = 1, AnchorPoint = Vector2.new(0.5, 0), Size = UDim2.fromOffset(360, 200), Parent = root })
new("UIListLayout", { Padding = UDim.new(0, 6), HorizontalAlignment = Enum.HorizontalAlignment.Center, SortOrder = Enum.SortOrder.LayoutOrder, Parent = toastHolder })
local cinema = new("Frame", { Name = "Cinema", BackgroundColor3 = Color3.fromRGB(5, 8, 20), BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), Visible = false, ZIndex = 50, Parent = root })
local cineKicker = label({ Text = "", Font = BOLD, TextSize = 14, TextColor3 = C.dim, TextXAlignment = Enum.TextXAlignment.Center, AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.new(0.5, 0, 0.36, 0), Size = UDim2.fromOffset(360, 20), ZIndex = 51, Parent = cinema })
local cineBig = label({ Text = "", Font = BOLD, TextSize = 72, TextXAlignment = Enum.TextXAlignment.Center, AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.new(0.5, 0, 0.45, 0), Size = UDim2.fromOffset(360, 80), ZIndex = 51, Parent = cinema })
local cineTitle = label({ Text = "", Font = BOLD, TextSize = 26, TextXAlignment = Enum.TextXAlignment.Center, AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.new(0.5, 0, 0.54, 0), Size = UDim2.fromOffset(380, 32), ZIndex = 51, Parent = cinema })
local cineDesc = label({ Text = "", TextSize = 15, TextColor3 = C.dim, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Center, AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0.59, 0), Size = UDim2.fromOffset(340, 60), ZIndex = 51, Parent = cinema })

local function toast(text, color)
	local f = new("Frame", { BackgroundColor3 = C.card, BackgroundTransparency = 0.05, Size = UDim2.fromOffset(340, 0), AutomaticSize = Enum.AutomaticSize.Y, Parent = toastHolder }, { corner(12), stroke(color or C.stroke, 1, 0.4), padding(12, 8) })
	local t = label({ Text = text, TextSize = 13, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Center, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, Parent = f })
	task.delay(3.6, function()
		local ti = TweenInfo.new(0.5)
		TweenService:Create(f, ti, { BackgroundTransparency = 1 }):Play()
		TweenService:Create(t, ti, { TextTransparency = 1 }):Play()
		task.wait(0.55)
		f:Destroy()
	end)
end

local cineToken = 0
local function showCinema(kicker, big, title, desc, color)
	cineToken = cineToken + 1
	local my = cineToken
	cineKicker.Text, cineBig.Text, cineTitle.Text, cineDesc.Text = kicker, big, title, desc
	cineBig.TextColor3 = color
	cinema.Visible = true
	cinema.BackgroundTransparency = 1
	for _, l in ipairs({ cineKicker, cineBig, cineTitle, cineDesc }) do l.TextTransparency = 1 end
	local ti = TweenInfo.new(0.45, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
	TweenService:Create(cinema, ti, { BackgroundTransparency = 0.35 }):Play()
	for _, l in ipairs({ cineKicker, cineBig, cineTitle, cineDesc }) do TweenService:Create(l, ti, { TextTransparency = 0 }):Play() end
	task.delay(2.8, function()
		if my ~= cineToken then return end
		local to = TweenInfo.new(0.6)
		TweenService:Create(cinema, to, { BackgroundTransparency = 1 }):Play()
		for _, l in ipairs({ cineKicker, cineBig, cineTitle, cineDesc }) do TweenService:Create(l, to, { TextTransparency = 1 }):Play() end
		task.wait(0.65)
		if my == cineToken then cinema.Visible = false end
	end)
end
cinema.InputBegan:Connect(function(input)
	if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
		cineToken = cineToken + 1
		cinema.Visible = false
	end
end)

-- ============================================================
--  Состояние с сервера
-- ============================================================
local S = nil           -- последний снимок состояния
local syncAt = 0
local rates = {}
local pendingTaps, sentGain = 0, 0
local buyMode = 1
local tab = nil
local topList = {}
local asteroidState = nil
local prestigeConfirmUntil = 0

local function shown(k)    -- значение ресурса с плавным приростом между обновлениями
	if not S then return 0 end
	if k == "gems" then return S.gems end
	local dt = math.min(1.5, os.clock() - syncAt)
	local v = (S.res[k] or 0) + (rates[k] or 0) * dt
	if k == "solar" then v = v + sentGain end
	return v
end
local function haveAll(cost)
	for k, v in pairs(cost) do
		if shown(k) < v then return false end
	end
	return true
end

-- ============================================================
--  Раскладка: телефон вертикально — панель снизу; широкий экран — панель справа
-- ============================================================
local panelW = 400
local function sheetOpen() return tab ~= nil end
local function layout()
	local vp = camera.ViewportSize
	local inset = GuiService:GetGuiInset()
	local vw, vh = vp.X, vp.Y - inset.Y
	WIDE = vw > vh * 1.15
	SCALE = math.clamp(math.min(vw / (WIDE and 900 or 410), vh / (WIDE and 640 or 780)), 0.55, 1.25)
	uiScale.Scale = SCALE
	W, H = vw / SCALE, vh / SCALE
	root.Size = UDim2.fromOffset(W, H)

	local leftW = W
	if WIDE and sheetOpen() then leftW = W - panelW - 16 end
	local cw = math.min(leftW - 16, 560)
	local cx = leftW / 2
	top.Size = UDim2.fromOffset(math.min(W - 16, 760), 54)
	top.Position = UDim2.fromOffset(W / 2, 6)
	if WIDE and sheetOpen() then
		top.Size = UDim2.fromOffset(math.min(leftW - 16, 760), 54)
		top.Position = UDim2.fromOffset(cx, 6)
	end
	info.Size = UDim2.fromOffset(cw, 18)
	info.Position = UDim2.fromOffset(cx, 64)
	warnLabel.Size = UDim2.fromOffset(cw, 30)
	warnLabel.Position = UDim2.fromOffset(cx, 84)
	banner.Position = UDim2.fromOffset(cx, 88)
	toastHolder.Position = UDim2.fromOffset(cx, 140)
	tabsBar.Size = UDim2.fromOffset(cw, 60)
	tabsBar.Position = UDim2.fromOffset(cx, H - 8)
	eraCard.Size = UDim2.fromOffset(cw, 92)
	eraCard.Position = UDim2.fromOffset(cx, H - 76)
	eraCard.Visible = not (sheetOpen() and not WIDE)
	if WIDE then
		sheet.Size = UDim2.fromOffset(panelW, H - 16)
		sheet.Position = UDim2.fromOffset(W - panelW - 8, 8)
	else
		local h = math.max(240, H - 76 - 124)
		sheet.Size = UDim2.fromOffset(cw, math.min(h, H * 0.62))
		sheet.Position = UDim2.fromOffset(cx - cw / 2, H - 76 - math.min(h, H * 0.62))
	end
	sheet.Visible = sheetOpen()
end

-- где на экране должна быть планета (в пикселях экрана) и её размер
local function planetTarget()
	local vp = camera.ViewportSize
	local inset = GuiService:GetGuiInset().Y
	local topPx = inset + (WIDE and 96 or 100) * SCALE
	local bottomPx = vp.Y - ((sheetOpen() and not WIDE) and (sheet.AbsoluteSize.Y + 76 * SCALE + 12) or (176 * SCALE))
	local leftPx, rightPx = 0, vp.X
	if WIDE and sheetOpen() then rightPx = vp.X - (panelW + 16) * SCALE end
	local cx, cy = (leftPx + rightPx) / 2, (topPx + bottomPx) / 2
	local radius = math.max(40, math.min(rightPx - leftPx, bottomPx - topPx) * 0.36)
	return cx, cy, radius
end

-- ============================================================
--  Камера и анимация планет
-- ============================================================
camera.CameraType = Enum.CameraType.Scriptable
camera.FieldOfView = 50
local camCF = nil
local function myModel() return planetsFolder:FindFirstChild("Planet_" .. player.UserId) end

local function cameraGoal()
	if not S or not S.center then return nil end
	local center = S.center
	local out = Vector3.new(center.X, 0, center.Z)
	out = out.Magnitude > 1 and out.Unit or Vector3.new(0, 0, 1)
	local right = Vector3.new(0, 1, 0):Cross(out).Unit
	local up = out:Cross(right).Unit
	local vp = camera.ViewportSize
	local px, py, rpx = planetTarget()
	local tanHalf = math.tan(math.rad(camera.FieldOfView / 2))
	local R = 12
	local dist = R * (vp.Y / 2) / (rpx * tanHalf)
	local upp = 2 * dist * tanHalf / vp.Y      -- стадов на пиксель на расстоянии планеты
	local dx = (vp.X / 2 - px) * upp
	local dy = -(vp.Y / 2 - py) * upp
	local pos = center + out * dist + right * dx + up * dy
	return CFrame.lookAt(pos, pos - out, up)
end

local bases = setmetatable({}, { __mode = "k" })
local spinT, frame = 0, 0
local function animatePlanets(dt)
	spinT = spinT + dt
	frame = frame + 1
	for _, m in ipairs(planetsFolder:GetChildren()) do
		local mine = m:GetAttribute("Owner") == player.UserId
		if mine or frame % 4 == 0 then
			local b = bases[m]
			if not b then
				b = {}
				for _, n in ipairs({ "Spin", "Clouds", "Orbit" }) do
					local part = m:FindFirstChild(n)
					if part then b[n] = part:GetPivot() end
				end
				bases[m] = b
				if mine then
					local tag = m:FindFirstChild("Static") and m.Static:FindFirstChild("Tag")
					if tag and tag:FindFirstChild("NameTag") then tag.NameTag.Enabled = false end
				end
			end
			local speeds = { Spin = 0.12, Clouds = 0.17, Orbit = 0.3 }
			for n, base in pairs(b) do
				local part = m:FindFirstChild(n)
				if part then part:PivotTo(base * CFrame.Angles(0, spinT * speeds[n], 0)) end
			end
		end
	end
end

local function animateAsteroids()
	local now = workspace:GetServerTimeNow()
	for _, a in ipairs(asteroidsFolder:GetChildren()) do
		local from, to = a:GetAttribute("From"), a:GetAttribute("To")
		local t0, dur = a:GetAttribute("T0"), a:GetAttribute("Dur")
		if from and to and t0 and dur then
			local t = math.clamp((now - t0) / dur, 0, 1)
			local e = 1 - (1 - t) * (1 - t)
			local p = from:Lerp(to, e) + Vector3.new(0, math.sin(t * math.pi) * 3, 0)
			a.CFrame = CFrame.new(p) * CFrame.Angles(now * 1.3, now * 0.9, 0)
		end
	end
end

-- ============================================================
--  Тапы
-- ============================================================
local rayParams = RaycastParams.new()
rayParams.FilterType = Enum.RaycastFilterType.Include
local hitQueue = {}

local function floatText(pos, text, color)
	local p = Vector2.new(pos.X / SCALE, pos.Y / SCALE)
	local l = label({ Text = text, Font = BOLD, TextSize = 20, TextColor3 = color or C.gold, TextStrokeTransparency = 0.4, TextXAlignment = Enum.TextXAlignment.Center, AnchorPoint = Vector2.new(0.5, 0.5), Size = UDim2.fromOffset(160, 26), Position = UDim2.fromOffset(p.X + math.random(-14, 14), p.Y - 8), ZIndex = 20, Parent = root })
	TweenService:Create(l, TweenInfo.new(0.9, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Position = UDim2.fromOffset(p.X, p.Y - 70), TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
	task.delay(0.95, function() l:Destroy() end)
end

local function pulsePlanet()
	local m = myModel()
	local core = m and m:FindFirstChild("Spin") and m.Spin:FindFirstChild("Core")
	if not core then return end
	local hl = core:FindFirstChild("TapGlow")
	if not hl then
		hl = new("Highlight", { Name = "TapGlow", FillColor = Color3.new(1, 1, 1), FillTransparency = 1, OutlineTransparency = 1, DepthMode = Enum.HighlightDepthMode.Occluded, Parent = core })
	end
	hl.FillTransparency = 0.82
	TweenService:Create(hl, TweenInfo.new(0.25), { FillTransparency = 1 }):Play()
end

local function onTap(screenPos)
	if not S then return end
	local m = myModel()
	rayParams.FilterDescendantsInstances = { asteroidsFolder, m }
	local ray = camera:ScreenPointToRay(screenPos.X, screenPos.Y)
	local hit = workspace:Raycast(ray.Origin, ray.Direction * 2000, rayParams)
	if not hit then return end
	local part = hit.Instance
	if part:IsDescendantOf(asteroidsFolder) then
		if part:GetAttribute("Owner") == player.UserId then
			local id = part:GetAttribute("Id")
			hitQueue[id] = (hitQueue[id] or 0) + 1
			floatText(screenPos, "−" .. fmt(Shared.clickGain(S, false)), Color3.fromRGB(253, 186, 116))
		end
		return
	end
	if m and part:IsDescendantOf(m) then
		pendingTaps = pendingTaps + 1
		local g = Shared.clickGain(S, false)
		sentGain = sentGain + g
		floatText(screenPos, "+" .. fmt(g) .. " ☀️")
		pulsePlanet()
	end
end

UserInputService.InputBegan:Connect(function(input, processed)
	if processed then return end
	if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
		onTap(input.Position)
	end
end)

-- тапы отправляются пачками, чтобы не забивать сеть
task.spawn(function()
	while true do
		task.wait(0.15)
		if pendingTaps > 0 then
			Action:FireServer("tap", pendingTaps)
			pendingTaps = 0
		end
		for id, n in pairs(hitQueue) do
			Action:FireServer("hit", id, n)
		end
		hitQueue = {}
	end
end)

-- ============================================================
--  Строки списков (создаются один раз и обновляются)
-- ============================================================
local rows = {}          -- [key] = { frame = ..., update = fn }
local rowOrder = 0
local function clearRows()
	for _, r in pairs(rows) do r.frame:Destroy() end
	rows = {}
	rowOrder = 0
end
local function addRow(key, frame, update)
	rowOrder = rowOrder + 1
	frame.LayoutOrder = rowOrder
	frame.Parent = scroll
	rows[key] = { frame = frame, update = update }
end
local function card(h)
	return new("Frame", { BackgroundColor3 = C.card, BackgroundTransparency = 0.1, Size = UDim2.new(1, 0, 0, h) }, { corner(14), stroke(C.stroke, 1, 0.8) })
end
local function section(text)
	local f = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 24) })
	label({ Text = text, Font = BOLD, TextSize = 12, TextColor3 = C.violet, Size = UDim2.new(1, -8, 1, 0), Position = UDim2.fromOffset(4, 0), Parent = f })
	return f
end

local function costColor(ok) return ok and C.good or C.card2 end

-- ---------- постройки ----------
local function buildRows()
	clearRows()
	local modes = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 34) })
	label({ Text = "КУПИТЬ", Font = BOLD, TextSize = 11, TextColor3 = C.dim, Size = UDim2.fromOffset(56, 34), Parent = modes })
	local mbtns = {}
	for i, m in ipairs(Shared.BUY_MODES) do
		local b = button({ Text = m == "max" and "MAX" or ("×" .. m), TextSize = 13, Size = UDim2.new(0.2, -14, 1, 0), Position = UDim2.new((i - 1) * 0.2, 56 - (i - 1) * 11, 0, 0) }, C.card2)
		b.Parent = modes
		b.Activated:Connect(function() buyMode = m; for _, x in pairs(rows) do x.update() end end)
		mbtns[m] = b
	end
	addRow("modes", modes, function()
		for m, b in pairs(mbtns) do b.BackgroundColor3 = (m == buyMode) and C.accent or C.card2 end
	end)
	local nextLocked = nil
	for _, b in ipairs(Shared.BUILDINGS) do
		if b.u <= S.era then
			local f = card(82)
			label({ Text = b.icon, TextSize = 30, TextXAlignment = Enum.TextXAlignment.Center, Size = UDim2.fromOffset(46, 46), Position = UDim2.fromOffset(8, 18), Parent = f })
			local name = label({ Text = b.name, Font = BOLD, TextSize = 14, Size = UDim2.new(1, -190, 0, 18), Position = UDim2.fromOffset(60, 8), TextTruncate = Enum.TextTruncate.AtEnd, Parent = f })
			label({ Text = b.desc, TextSize = 11, TextColor3 = C.dim, Size = UDim2.new(1, -190, 0, 28), Position = UDim2.fromOffset(60, 27), TextWrapped = true, TextYAlignment = Enum.TextYAlignment.Top, Parent = f })
			local prod = label({ Text = "", Font = BOLD, TextSize = 11, TextColor3 = C.good, Size = UDim2.new(1, -190, 0, 16), Position = UDim2.fromOffset(60, 58), TextTruncate = Enum.TextTruncate.AtEnd, Parent = f })
			local btn = button({ Text = "", Size = UDim2.fromOffset(118, 62), AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, -10, 0.5, 0) }, C.card2)
			btn.Parent = f
			local bt = label({ Text = "Построить", Font = BOLD, TextSize = 13, TextXAlignment = Enum.TextXAlignment.Center, Size = UDim2.new(1, 0, 0, 18), Position = UDim2.fromOffset(0, 8), Parent = btn })
			local bc = label({ Text = "", TextSize = 11, TextXAlignment = Enum.TextXAlignment.Center, TextWrapped = true, Size = UDim2.new(1, -8, 0, 30), Position = UDim2.fromOffset(4, 27), Parent = btn })
			btn.Activated:Connect(function() Action:FireServer("buy", b.id, buyMode) end)
			addRow(b.id, f, function()
				local cnt = S.counts[b.id] or 0
				name.Text = b.name .. (cnt > 0 and ("  ×" .. cnt) or "")
				local parts = {}
				local m = Shared.prodMult(S, false)
				for _, k in ipairs(Shared.RES_ORDER) do
					if b.prod[k] then table.insert(parts, "+" .. Shared.fmtRate(b.prod[k] * m) .. Shared.RES[k].icon) end
				end
				prod.Text = table.concat(parts, " ") .. " /с"
				local n = buyMode
				if buyMode == "max" then n = math.max(1, Shared.maxAffordable(S, b)) end
				local cost = Shared.bulkCost(S, b, n)
				local ok = haveAll(cost)
				bt.Text = "Построить" .. (n > 1 and (" ×" .. n) or "")
				bc.Text = Shared.costText(cost)
				btn.BackgroundColor3 = costColor(ok)
				btn.AutoButtonColor = ok
			end)
		elseif not nextLocked then
			nextLocked = b
		end
	end
	if nextLocked then
		local f = card(46)
		f.BackgroundTransparency = 0.5
		label({ Text = "🔒 " .. nextLocked.icon .. " " .. nextLocked.name .. " — откроется в эпохе " .. (nextLocked.u + 1), TextSize = 12, TextColor3 = C.dim, TextWrapped = true, Size = UDim2.new(1, -20, 1, 0), Position = UDim2.fromOffset(10, 0), Parent = f })
		addRow("locked", f, function() end)
	end
end

-- ---------- улучшения ----------
local function perkEffect(id, l)
	if id == "autoclicker" then return "Выстрелов: " .. (l * 2) .. "/с"
	elseif id == "time_warp" then return "Скорость: +" .. (l * 25) .. "%"
	elseif id == "cheap_build" then return "Скидка: −" .. (l * 10) .. "%"
	elseif id == "starter_pack" then return "После престижа: +" .. (l * 300) .. " ☀️💧💨"
	elseif id == "crit_solar" then return l > 0 and ("Шанс 15%, урон ×" .. (2 + l)) or "Откроет криты (шанс 15%)"
	elseif id == "gaia" then return "Доход: +" .. (l * 25) .. "%"
	elseif id == "tectonics" then return "Тап: +" .. (l * 50) .. "%"
	elseif id == "oceans" then return "Скидка: −" .. (l * 8) .. "%"
	end
	return ""
end
local function perkRow(p, isGlobal)
	local f = card(76)
	label({ Text = p.icon, TextSize = 28, TextXAlignment = Enum.TextXAlignment.Center, Size = UDim2.fromOffset(46, 46), Position = UDim2.fromOffset(8, 15), Parent = f })
	local name = label({ Text = p.name, Font = BOLD, TextSize = 14, Size = UDim2.new(1, -170, 0, 18), Position = UDim2.fromOffset(60, 8), TextTruncate = Enum.TextTruncate.AtEnd, Parent = f })
	label({ Text = p.desc, TextSize = 11, TextColor3 = C.dim, Size = UDim2.new(1, -170, 0, 28), Position = UDim2.fromOffset(60, 27), TextWrapped = true, TextYAlignment = Enum.TextYAlignment.Top, Parent = f })
	local eff = label({ Text = "", Font = BOLD, TextSize = 11, TextColor3 = C.violet, Size = UDim2.new(1, -170, 0, 16), Position = UDim2.fromOffset(60, 55), Parent = f })
	local btn = button({ Text = "", Size = UDim2.fromOffset(98, 48), AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, -10, 0.5, 0) }, C.card2)
	btn.Parent = f
	btn.Activated:Connect(function() Action:FireServer(isGlobal and "gperk" or "perk", p.id) end)
	return f, function()
		local l = isGlobal and Shared.perk(S, p.id) or Shared.ppk(S, p.id)
		name.Text = p.name .. "  " .. l .. "/" .. p.max
		eff.Text = perkEffect(p.id, l)
		if l >= p.max then
			btn.Text = "MAX"; btn.BackgroundColor3 = C.card2; btn.AutoButtonColor = false
		else
			local c = Shared.perkCost(p, l)
			btn.Text = "💎 " .. fmt(c)
			local ok = S.gems >= c
			btn.BackgroundColor3 = ok and Color3.fromRGB(139, 92, 246) or C.card2
			btn.AutoButtonColor = ok
		end
	end
end
local function perkRows()
	clearRows()
	local hint = card(40)
	hint.BackgroundTransparency = 0.5
	local gemsLabel = label({ Text = "", TextSize = 12, TextColor3 = C.dim, TextWrapped = true, Size = UDim2.new(1, -20, 1, 0), Position = UDim2.fromOffset(10, 0), Parent = hint })
	addRow("hint", hint, function() gemsLabel.Text = "💎 Кристаллов: " .. fmt(S.gems) .. " — дают астероиды и престиж" end)
	addRow("s1", section("🌳 ДРЕВО ВЕЧНОСТИ"), function() end)
	for _, p in ipairs(Shared.GLOBAL_PERKS) do
		local f, upd = perkRow(p, true)
		addRow("g_" .. p.id, f, upd)
	end
	addRow("s2", section("🌍 УЛУЧШЕНИЯ ЗЕМЛИ"), function() end)
	for _, p in ipairs(Shared.PERKS) do
		local f, upd = perkRow(p, false)
		addRow("p_" .. p.id, f, upd)
	end
end

-- ---------- престиж ----------
local function prestigeRows()
	clearRows()
	local head = card(84)
	local t1 = label({ Text = "", Font = BOLD, TextSize = 16, Size = UDim2.new(1, -24, 0, 22), Position = UDim2.fromOffset(12, 10), Parent = head })
	label({ Text = "Престиж сбрасывает эпоху, постройки и ресурсы Земли, но доход и тап навсегда растут, а за престиж дают кристаллы.", TextSize = 11, TextColor3 = C.dim, TextWrapped = true, Size = UDim2.new(1, -24, 0, 40), Position = UDim2.fromOffset(12, 36), Parent = head })
	addRow("head", head, function() t1.Text = "🌀 Престижей: " .. S.ppr .. "   ·   доход ×" .. (S.ppr + 1) end)
	addRow("sg", section("ЦЕЛИ СЛЕДУЮЩЕГО ПРЕСТИЖА"), function() end)
	for i = 1, 3 do
		local f = card(40)
		local t = label({ Text = "", TextSize = 13, Size = UDim2.new(1, -20, 1, 0), Position = UDim2.fromOffset(10, 0), TextTruncate = Enum.TextTruncate.AtEnd, Parent = f })
		addRow("goal" .. i, f, function()
			local g = Shared.prestigeInfo(S).goals[i]
			f.Visible = g ~= nil
			if not g then return end
			local mark = g.ok and "✅ " or "⬜ "
			if g.kind == "stage" then t.Text = mark .. "Эпоха " .. (g.need + 1) .. " «" .. Shared.ERAS[g.need + 1].name .. "» — сейчас " .. (S.era + 1)
			elseif g.kind == "build" then t.Text = mark .. "Построек: " .. fmt(g.have) .. " / " .. fmt(g.need)
			else t.Text = mark .. "Накопить ☀️ " .. fmt(g.need) .. " (есть " .. fmt(shown("solar")) .. ")" end
			t.TextColor3 = g.ok and C.text or C.dim
		end)
	end
	local f = card(96)
	local reward = label({ Text = "", Font = BOLD, TextSize = 14, TextColor3 = C.violet, TextXAlignment = Enum.TextXAlignment.Center, Size = UDim2.new(1, -20, 0, 22), Position = UDim2.fromOffset(10, 8), Parent = f })
	local btn = button({ Text = "Совершить престиж", Size = UDim2.new(1, -24, 0, 48), Position = UDim2.fromOffset(12, 38) }, C.card2)
	btn.Parent = f
	btn.Activated:Connect(function()
		if not Shared.prestigeInfo(S).ready then return end
		if os.clock() < prestigeConfirmUntil then
			prestigeConfirmUntil = 0
			Action:FireServer("prestige")
		else
			prestigeConfirmUntil = os.clock() + 4
			btn.Text = "Нажмите ещё раз — Земля начнёт заново"
		end
	end)
	addRow("go", f, function()
		local pi = Shared.prestigeInfo(S)
		reward.Text = "Награда: +" .. pi.gems .. " 💎 и доход ×" .. pi.nextMult
		btn.BackgroundColor3 = pi.ready and Color3.fromRGB(139, 92, 246) or C.card2
		btn.AutoButtonColor = pi.ready
		if os.clock() >= prestigeConfirmUntil then btn.Text = pi.ready and "🌀 Совершить престиж" or "Цели ещё не выполнены" end
	end)
end

-- ---------- топ ----------
local function topRows()
	clearRows()
	addRow("s1", section("🏆 МИРОВОЙ ТОП · престиж 100 очков, эпоха 1"), function() end)
	if #topList == 0 then
		local f = card(40)
		f.BackgroundTransparency = 0.5
		label({ Text = "Топ загружается… (обновляется раз в минуту)", TextSize = 12, TextColor3 = C.dim, Size = UDim2.new(1, -20, 1, 0), Position = UDim2.fromOffset(10, 0), Parent = f })
		addRow("empty", f, function() end)
	end
	for i, e in ipairs(topList) do
		local f = card(40)
		if e.me == player.UserId then f.BackgroundColor3 = Color3.fromRGB(60, 50, 110) end
		local medal = ({ "🥇", "🥈", "🥉" })[i] or tostring(i)
		label({ Text = medal, Font = BOLD, TextSize = 15, TextXAlignment = Enum.TextXAlignment.Center, Size = UDim2.fromOffset(34, 40), Position = UDim2.fromOffset(4, 0), Parent = f })
		label({ Text = e.name, Font = BOLD, TextSize = 13, Size = UDim2.new(1, -150, 1, 0), Position = UDim2.fromOffset(42, 0), TextTruncate = Enum.TextTruncate.AtEnd, Parent = f })
		label({ Text = "★ " .. fmt(e.score) .. "  🌀 " .. math.floor(e.score / 100), TextSize = 12, TextColor3 = C.dim, TextXAlignment = Enum.TextXAlignment.Right, Size = UDim2.fromOffset(110, 40), AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -10, 0, 0), Parent = f })
		addRow("t" .. i, f, function() end)
	end
	addRow("s2", section("👥 НА ЭТОМ СЕРВЕРЕ"), function() end)
	local list = {}
	for _, pl in ipairs(Players:GetPlayers()) do
		local ls = pl:FindFirstChild("leaderstats")
		local era = ls and ls:FindFirstChild("Эпоха") and ls["Эпоха"].Value or 1
		local pr = ls and ls:FindFirstChild("Престиж") and ls["Престиж"].Value or 0
		table.insert(list, { name = pl.DisplayName, era = era, ppr = pr, me = pl == player })
	end
	table.sort(list, function(a, b) return a.ppr * 100 + a.era > b.ppr * 100 + b.era end)
	for i, e in ipairs(list) do
		local f = card(36)
		if e.me then f.BackgroundColor3 = Color3.fromRGB(60, 50, 110) end
		label({ Text = i .. ". " .. e.name, Font = BOLD, TextSize = 13, Size = UDim2.new(1, -140, 1, 0), Position = UDim2.fromOffset(12, 0), TextTruncate = Enum.TextTruncate.AtEnd, Parent = f })
		label({ Text = "Эпоха " .. e.era .. (e.ppr > 0 and ("  🌀 " .. e.ppr) or ""), TextSize = 12, TextColor3 = C.dim, TextXAlignment = Enum.TextXAlignment.Right, Size = UDim2.fromOffset(120, 36), AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -10, 0, 0), Parent = f })
		addRow("p" .. i, f, function() end)
	end
end

-- ============================================================
--  Обновление экрана
-- ============================================================
local builtFor = nil     -- для какой вкладки/эпохи построены строки
local TITLES = { build = "🏗️ Постройки", perks = "🌳 Улучшения", prestige = "🌀 Престиж Земли", top = "🏆 Топ игроков" }
local function renderPanel(force)
	if not S or not tab then return end
	local key = tab .. "|" .. S.era .. (tab == "top" and ("|" .. #topList .. "|" .. #Players:GetPlayers()) or "")
	if force or key ~= builtFor then
		builtFor = key
		sheetTitle.Text = TITLES[tab]
		if tab == "build" then buildRows()
		elseif tab == "perks" then perkRows()
		elseif tab == "prestige" then prestigeRows()
		else topRows() end
	end
	for _, r in pairs(rows) do r.update() end
end

local function selectTab(id)
	if tab == id then tab = nil else tab = id end
	builtFor = nil
	for tid, t in pairs(tabButtons) do
		local on = tid == tab
		t.btn.BackgroundTransparency = on and 0.6 or 1
	end
	layout()
	renderPanel(true)
end
for id, t in pairs(tabButtons) do
	t.btn.Activated:Connect(function() selectTab(id) end)
end
sheetClose.Activated:Connect(function() if tab then selectTab(tab) end end)
evolveBtn.Activated:Connect(function() Action:FireServer("evolve") end)

local function renderHud()
	if not S then return end
	for _, k in ipairs(PILL_KEYS) do
		pills[k].value.Text = fmt(shown(k))
		if k == "gems" then pills[k].rate.Text = "Кристаллы"
		else
			local r = rates[k] or 0
			if k == "solar" then r = r + Shared.perk(S, "autoclicker") * 2 * Shared.clickGain(S, false) end
			pills[k].rate.Text = r > 0 and ("+" .. Shared.fmtRate(r) .. "/с") or Shared.RES[k].name
		end
	end
	local E = Shared.ERAS[S.era + 1]
	info.Text = "🌍 Земля · эпоха " .. (S.era + 1) .. " · доход ×" .. (S.ppr + 1) .. (S.ppr > 0 and ("  ·  🌀 " .. S.ppr) or "") .. "  ·  тап +" .. fmt(Shared.clickGain(S, false))
	eraKicker.Text = "ЭПОХА " .. (S.era + 1)
	eraKicker.BackgroundColor3 = rgb(E.halo)
	eraName.Text = E.name
	local cost = Shared.eraCost(S)
	if cost then
		local ratio = 1
		for k, v in pairs(cost) do ratio = math.min(ratio, shown(k) / v) end
		local ok = ratio >= 1
		eraNext.Text = "Далее: «" .. Shared.ERAS[S.era + 2].name .. "»   " .. Shared.costText(cost)
		eraBar.Size = UDim2.fromScale(math.clamp(ratio, 0, 1), 1)
		evolveBtn.Text = "Эволюция"
		evolveBtn.BackgroundColor3 = ok and C.good or C.card2
		evolveBtn.AutoButtonColor = ok
	else
		eraNext.Text = "Земля прошла все 15 эпох! Время для престижа 🌀"
		eraBar.Size = UDim2.fromScale(1, 1)
		evolveBtn.Text = "Максимум"
		evolveBtn.BackgroundColor3 = C.card2
		evolveBtn.AutoButtonColor = false
	end
	tabButtons.prestige.dot.Visible = Shared.prestigeInfo(S).ready
	local canPerk = false
	for _, p in ipairs(Shared.GLOBAL_PERKS) do
		local l = Shared.perk(S, p.id)
		if l < p.max and S.gems >= Shared.perkCost(p, l) then canPerk = true end
	end
	tabButtons.perks.dot.Visible = canPerk
	warnLabel.Visible = S.noSave == true
	warnLabel.Text = "⚠️ Прогресс сейчас не сохраняется"
	if asteroidState then
		local left = math.max(0, asteroidState.dur - (os.clock() - asteroidState.at))
		bannerText.Text = (asteroidState.golden and "✨ ЗОЛОТОЙ АСТЕРОИД! ЖМИ!" or "☄️ АСТЕРОИД! ЖМИ НА НЕГО!") .. "  " .. string.format("%.1f", left) .. "с"
		bannerBar.Size = UDim2.fromScale(math.clamp(asteroidState.hp / asteroidState.maxHp, 0, 1), 1)
	end
end

-- ============================================================
--  События сервера
-- ============================================================
Sync.OnClientEvent:Connect(function(snap)
	local first = S == nil
	S = snap
	syncAt = os.clock()
	sentGain = pendingTaps * Shared.clickGain(S, false)
	rates = Shared.rates(S, false)
	if first then
		layout()
		if WIDE then selectTab("build") end
	end
	renderHud()
	renderPanel(false)
end)

Fx.OnClientEvent:Connect(function(kind, d)
	if kind == "evolve" then
		local E = Shared.ERAS[d.era + 1]
		local unlocks = {}
		for _, b in ipairs(Shared.BUILDINGS) do
			if b.u == d.era then table.insert(unlocks, b.icon .. " " .. b.name) end
		end
		showCinema("НОВАЯ ЭПОХА", tostring(d.era + 1), E.name, E.desc .. (#unlocks > 0 and ("\nОткрыто: " .. table.concat(unlocks, ", ")) or ""), rgb(E.halo))
	elseif kind == "prestige" then
		showCinema("ЗЕМЛЯ · ПРЕСТИЖ №" .. d.n, "🌀", "Доход ×" .. (d.n + 1), "Планета начала путь заново, но стала сильнее. +" .. d.gems .. " 💎 на улучшения.", C.violet)
	elseif kind == "asteroid" then
		asteroidState = { id = d.id, golden = d.golden, hp = d.hp, maxHp = d.maxHp, dur = d.dur, at = os.clock() }
		banner.BackgroundColor3 = d.golden and Color3.fromRGB(120, 90, 10) or Color3.fromRGB(120, 30, 20)
		banner.Visible = true
	elseif kind == "asteroidHp" then
		if asteroidState and asteroidState.id == d.id then asteroidState.hp = d.hp end
	elseif kind == "asteroidDone" then
		asteroidState = nil
		banner.Visible = false
		toast((d.golden and "✨ Золотой астероид" or "☄️ Астероид") .. " уничтожен! +" .. d.gems .. " 💎, +" .. fmt(d.bonus) .. " ☀️", C.gold)
	elseif kind == "asteroidMiss" then
		if asteroidState then toast("💥 Астероид упал на планету — в следующий раз успейте!", C.bad) end
		asteroidState = nil
		banner.Visible = false
	elseif kind == "offline" then
		local h = math.floor(d.sec / 3600)
		local m = math.floor((d.sec % 3600) / 60)
		toast("😴 Пока вас не было " .. (h > 0 and (h .. " ч " .. m .. " мин") or (m .. " мин")) .. ": +" .. fmt(d.gain) .. " ☀️ и другие ресурсы", C.good)
	elseif kind == "toast" then
		toast(d.text, C.bad)
	end
end)

Top.OnClientEvent:Connect(function(list)
	topList = list or {}
	if tab == "top" then renderPanel(true) end
end)

-- ============================================================
--  Каждый кадр
-- ============================================================
camera:GetPropertyChangedSignal("ViewportSize"):Connect(function() layout(); builtFor = nil; renderPanel(true) end)
layout()
local hudTimer = 0
RunService.RenderStepped:Connect(function(dt)
	if camera.CameraType ~= Enum.CameraType.Scriptable then camera.CameraType = Enum.CameraType.Scriptable end
	animatePlanets(dt)
	animateAsteroids()
	local goal = cameraGoal()
	if goal then
		camCF = camCF and camCF:Lerp(goal, math.min(1, dt * 4)) or goal
		camera.CFrame = camCF
	end
	hudTimer = hudTimer + dt
	if hudTimer > 0.2 then
		hudTimer = 0
		renderHud()
	end
end)
