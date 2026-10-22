-- Упрощённая «песочница Roblox» для дымовой проверки скриптов без Studio:
-- экземпляры (Instance) с детьми и атрибутами, сигналы, RemoteEvent (сервер ↔ клиент в одном процессе),
-- DataStore в памяти, виртуальное время и планировщик task.*. Физики и рендера нет —
-- проверяется, что код запускается, не падает и правильно отвечает на действия игрока.
local M = {}

-- ---------- время и планировщик ----------
local now = 0
local queue = {}
M.errors = {}
local function resume(co, ...)
	local ok, err = coroutine.resume(co, ...)
	if not ok then table.insert(M.errors, debug.traceback(co, tostring(err))) end
end
local task = {}
function task.spawn(fn, ...)
	local co = type(fn) == "thread" and fn or coroutine.create(fn)
	resume(co, ...)
	return co
end
function task.defer(fn, ...)
	table.insert(queue, { co = coroutine.create(fn), at = now, args = { ... } })
end
function task.delay(t, fn, ...)
	table.insert(queue, { co = coroutine.create(fn), at = now + (t or 0), args = { ... } })
end
function task.wait(t)
	t = t or 0.03
	table.insert(queue, { co = coroutine.running(), at = now + t, args = { t } })
	return coroutine.yield()
end
M.task = task
function M.clock() return now end
function M.run(seconds)
	local target = now + seconds
	while true do
		local idx, best = nil, math.huge
		for i, q in ipairs(queue) do
			if q.at < best then best = q.at; idx = i end
		end
		if not idx or best > target then now = target; return end
		local q = table.remove(queue, idx)
		if q.at > now then now = q.at end
		resume(q.co, table.unpack(q.args))
	end
end

-- ---------- типы данных ----------
local V3 = {}
V3.__index = function(v, k)
	if k == "Magnitude" then return math.sqrt(v.X * v.X + v.Y * v.Y + v.Z * v.Z) end
	if k == "Unit" then local m = math.sqrt(v.X * v.X + v.Y * v.Y + v.Z * v.Z); if m == 0 then return v end return M.Vector3.new(v.X / m, v.Y / m, v.Z / m) end
	return V3[k]
end
M.Vector3 = { new = function(x, y, z) return setmetatable({ X = x or 0, Y = y or 0, Z = z or 0 }, V3) end }
V3.__add = function(a, b) return M.Vector3.new(a.X + b.X, a.Y + b.Y, a.Z + b.Z) end
V3.__sub = function(a, b) return M.Vector3.new(a.X - b.X, a.Y - b.Y, a.Z - b.Z) end
V3.__unm = function(a) return M.Vector3.new(-a.X, -a.Y, -a.Z) end
V3.__mul = function(a, b)
	if type(a) == "number" then a, b = b, a end
	if type(b) == "number" then return M.Vector3.new(a.X * b, a.Y * b, a.Z * b) end
	return M.Vector3.new(a.X * b.X, a.Y * b.Y, a.Z * b.Z)
end
V3.__div = function(a, b) return M.Vector3.new(a.X / b, a.Y / b, a.Z / b) end
V3.__eq = function(a, b) return a.X == b.X and a.Y == b.Y and a.Z == b.Z end
function V3.Lerp(a, b, t) return a + (b - a) * t end
function V3.Cross(a, b) return M.Vector3.new(a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X) end
function V3.Dot(a, b) return a.X * b.X + a.Y * b.Y + a.Z * b.Z end

local V2 = {}
V2.__index = V2
M.Vector2 = { new = function(x, y) return setmetatable({ X = x or 0, Y = y or 0 }, V2) end }

-- CFrame: позиция + матрица поворота (столбцы — оси X, Y, Z)
local CF = {}
CF.__index = function(c, k)
	if k == "Position" then return c.p end
	if k == "LookVector" then return -c.zv end
	return CF[k]
end
local function cf(p, xv, yv, zv) return setmetatable({ p = p, xv = xv, yv = yv, zv = zv }, CF) end
local I = function() return M.Vector3.new(1, 0, 0), M.Vector3.new(0, 1, 0), M.Vector3.new(0, 0, 1) end
M.CFrame = {}
function M.CFrame.new(x, y, z)
	local p = type(x) == "table" and x or M.Vector3.new(x or 0, y or 0, z or 0)
	local a, b, c = I()
	return cf(p, a, b, c)
end
local function rot(axis, ang)
	local c, s = math.cos(ang), math.sin(ang)
	if axis == "x" then return M.Vector3.new(1, 0, 0), M.Vector3.new(0, c, s), M.Vector3.new(0, -s, c) end
	if axis == "y" then return M.Vector3.new(c, 0, -s), M.Vector3.new(0, 1, 0), M.Vector3.new(s, 0, c) end
	return M.Vector3.new(c, s, 0), M.Vector3.new(-s, c, 0), M.Vector3.new(0, 0, 1)
end
function M.CFrame.Angles(rx, ry, rz)
	local x = cf(M.Vector3.new(), rot("x", rx))
	local y = cf(M.Vector3.new(), rot("y", ry))
	local z = cf(M.Vector3.new(), rot("z", rz))
	return x * y * z
end
function M.CFrame.lookAt(pos, target, up)
	up = up or M.Vector3.new(0, 1, 0)
	local z = (pos - target).Unit
	local x = up:Cross(z).Unit
	local y = z:Cross(x)
	return cf(pos, x, y, z)
end
local function apply(c, v) return c.xv * v.X + c.yv * v.Y + c.zv * v.Z end
CF.__mul = function(a, b)
	if getmetatable(b) == V3 then return a.p + apply(a, b) end
	return cf(a.p + apply(a, b.p), apply(a, b.xv), apply(a, b.yv), apply(a, b.zv))
end
function CF.Lerp(a, b, t) return cf(a.p:Lerp(b.p, t), b.xv, b.yv, b.zv) end

M.Color3 = {
	new = function(r, g, b) return { R = r or 0, G = g or 0, B = b or 0 } end,
	fromRGB = function(r, g, b) return { R = r / 255, G = g / 255, B = b / 255 } end,
}
M.UDim = { new = function(s, o) return { Scale = s, Offset = o } end }
M.UDim2 = {
	new = function(xs, xo, ys, yo) return { X = { Scale = xs or 0, Offset = xo or 0 }, Y = { Scale = ys or 0, Offset = yo or 0 } } end,
	fromOffset = function(x, y) return { X = { Scale = 0, Offset = x or 0 }, Y = { Scale = 0, Offset = y or 0 } } end,
	fromScale = function(x, y) return { X = { Scale = x or 0, Offset = 0 }, Y = { Scale = y or 0, Offset = 0 } } end,
}
M.TweenInfo = { new = function(...) return { ... } end }
M.RaycastParams = { new = function() return {} end }
M.ColorSequence = { new = function(...) return { ... } end }

-- Enum.<Тип>.<Имя> — одинаковый объект при каждом обращении
local enumCache = {}
M.Enum = setmetatable({}, { __index = function(_, t)
	enumCache[t] = enumCache[t] or setmetatable({}, { __index = function(tbl, n)
		local token = setmetatable({ EnumType = t, Name = n }, { __tostring = function() return "Enum." .. t .. "." .. n end })
		rawset(tbl, n, token)
		return token
	end })
	return enumCache[t]
end })

-- ---------- сигналы ----------
local Signal = {}
Signal.__index = Signal
function M.newSignal() return setmetatable({ handlers = {}, pending = {} }, Signal) end
function Signal:Connect(fn)
	table.insert(self.handlers, fn)
	-- события RemoteEvent, пришедшие до подключения, доставляются сразу (как в Roblox)
	local pend = self.pending
	self.pending = {}
	for _, args in ipairs(pend) do task.spawn(fn, table.unpack(args, 1, args.n)) end
	return { Disconnect = function() end }
end
function Signal:Fire(...)
	for _, fn in ipairs(self.handlers) do task.spawn(fn, ...) end
end
function Signal:FireQueued(...)
	if #self.handlers == 0 then table.insert(self.pending, table.pack(...)); return end
	self:Fire(...)
end
function Signal:Wait() local co = coroutine.running(); table.insert(self.handlers, function(...) task.spawn(co, ...) end); return coroutine.yield() end

-- ---------- экземпляры ----------
local D = setmetatable({}, { __mode = "k" })
local methods = {}
local EVENTS = { InputBegan = true, InputEnded = true, Activated = true, MouseButton1Click = true, OnServerEvent = true, OnClientEvent = true,
	PlayerAdded = true, PlayerRemoving = true, RenderStepped = true, Heartbeat = true, Changed = true, CharacterAdded = true, ChildAdded = true }
local DEFAULTS = {
	AbsoluteSize = function() return M.Vector2.new(360, 420) end,
	AbsolutePosition = function() return M.Vector2.new(0, 0) end,
	Value = function() return 0 end,
}
local instMT = {}
instMT.__index = function(self, k)
	local d = D[self]
	if k == "Name" then return d.name end
	if k == "ClassName" then return d.class end
	if k == "Parent" then return d.parent end
	local m = methods[k]
	if m then return m end
	local v = d.props[k]
	if v ~= nil then return v end
	if EVENTS[k] then d.props[k] = M.newSignal(); return d.props[k] end
	for _, c in ipairs(d.children) do
		if D[c].name == k then return c end
	end
	if DEFAULTS[k] then return DEFAULTS[k]() end
	return nil
end
instMT.__newindex = function(self, k, v)
	local d = D[self]
	if k == "Parent" then
		if d.parent then
			local pc = D[d.parent].children
			for i, c in ipairs(pc) do if c == self then table.remove(pc, i); break end end
		end
		d.parent = v
		if v then table.insert(D[v].children, self); if D[v].props.ChildAdded then D[v].props.ChildAdded:Fire(self) end end
		return
	end
	if k == "Name" then d.name = v; return end
	if d.readonly and d.readonly[k] then error(k .. " is read-only") end
	d.props[k] = v
	local s = d.changed[k]
	if s then s:Fire() end
end
instMT.__tostring = function(self) return D[self].name end

M.created = {}
function M.newInstance(class, name)
	local self = setmetatable({}, instMT)
	D[self] = { class = class, name = name or class, children = {}, props = {}, attrs = {}, changed = {} }
	M.created[class] = (M.created[class] or 0) + 1
	return self
end
function methods:FindFirstChild(name)
	for _, c in ipairs(D[self].children) do if D[c].name == name then return c end end
	return nil
end
function methods:FindFirstChildOfClass(class)
	for _, c in ipairs(D[self].children) do if D[c].class == class then return c end end
	return nil
end
function methods:WaitForChild(name)
	for _ = 1, 400 do
		local c = methods.FindFirstChild(self, name)
		if c then return c end
		task.wait(0.05)
	end
	error("Infinite yield: " .. D[self].name .. ":WaitForChild(" .. name .. ")")
end
function methods:GetChildren() local t = {}; for i, c in ipairs(D[self].children) do t[i] = c end; return t end
function methods:GetDescendants()
	local out = {}
	local function walk(x) for _, c in ipairs(D[x].children) do table.insert(out, c); walk(c) end end
	walk(self)
	return out
end
function methods:IsA(class) return D[self].class == class end
function methods:Destroy()
	self.Parent = nil
	D[self].destroyed = true
end
function methods:IsDescendantOf(anc)
	local p = D[self].parent
	while p do if p == anc then return true end; p = D[p].parent end
	return false
end
function methods:SetAttribute(k, v) D[self].attrs[k] = v end
function methods:GetAttribute(k) return D[self].attrs[k] end
function methods:GetPropertyChangedSignal(k)
	local d = D[self]
	d.changed[k] = d.changed[k] or M.newSignal()
	return d.changed[k]
end
function methods:GetPivot() return D[self].props.WorldPivot or D[self].props.CFrame or M.CFrame.new() end
function methods:PivotTo(c) D[self].props.WorldPivot = c end
-- RemoteEvent
function methods:FireServer(...) D[self].props.OnServerEvent = D[self].props.OnServerEvent or M.newSignal(); D[self].props.OnServerEvent:FireQueued(M.localPlayer, ...) end
function methods:FireClient(_player, ...) D[self].props.OnClientEvent = D[self].props.OnClientEvent or M.newSignal(); D[self].props.OnClientEvent:FireQueued(...) end
function methods:FireAllClients(...) methods.FireClient(self, nil, ...) end

-- ---------- службы ----------
M.stores = {}
local function newStore(name)
	M.stores[name] = M.stores[name] or {}
	local data = M.stores[name]
	return {
		GetAsync = function(_, k) if M.storeFails then error("HTTP 403 (Studio access to API services is not allowed)") end return data[k] end,
		SetAsync = function(_, k, v) if M.storeFails then error("HTTP 403") end data[k] = v end,
		GetSortedAsync = function(_, asc, size)
			local list = {}
			for k, v in pairs(data) do table.insert(list, { key = k, value = v }) end
			table.sort(list, function(a, b) return a.value > b.value end)
			return { GetCurrentPage = function() local t = {}; for i = 1, math.min(size, #list) do t[i] = list[i] end; return t end }
		end,
	}
end

function M.newGame()
	local game = M.newInstance("DataModel", "game")
	local services = {}
	local function svc(name)
		if not services[name] then
			local s = M.newInstance(name, name)
			s.Parent = game
			services[name] = s
		end
		return services[name]
	end
	local ws = svc("Workspace")
	local camera = M.newInstance("Camera", "Camera")
	camera.ViewportSize = M.Vector2.new(1280, 760)
	camera.FieldOfView = 70
	camera.CFrame = M.CFrame.new()
	camera.Parent = ws
	ws.CurrentCamera = camera
	D[ws].props.GetServerTimeNow = function() return now end
	D[ws].props.Raycast = function(_, origin, dir, params) return M.raycastHook and M.raycastHook(origin, dir, params) or nil end
	D[camera].props.ScreenPointToRay = function(_, x, y) return { Origin = M.Vector3.new(x, y, 0), Direction = M.Vector3.new(0, 0, -1) } end
	local players = svc("Players")
	players.CharacterAutoLoads = true
	D[players].props.GetPlayers = function(self) return methods.GetChildren(self) end
	D[players].props.GetNameFromUserIdAsync = function(_, id) return "Player" .. id end
	local ds = svc("DataStoreService")
	D[ds].props.GetDataStore = function(_, name) return newStore(name) end
	D[ds].props.GetOrderedDataStore = function(_, name) return newStore("ordered:" .. name) end
	local rs = svc("RunService")
	D[rs].props.IsStudio = function() return true end
	local ts = svc("TweenService")
	D[ts].props.Create = function(_, inst, info, goal) return { Play = function() for k, v in pairs(goal) do inst[k] = v end end } end
	local uis = svc("UserInputService")
	uis.TouchEnabled = false
	uis.KeyboardEnabled = true
	local gs = svc("GuiService")
	D[gs].props.GetGuiInset = function() return M.Vector2.new(0, 58), M.Vector2.new(0, 0) end
	svc("Lighting"); svc("ReplicatedStorage"); svc("ServerScriptService"); svc("StarterPlayer")
	D[game].props.GetService = function(_, name) return svc(name) end
	M.closeHandlers = {}
	D[game].props.BindToClose = function(_, fn) table.insert(M.closeHandlers, fn) end
	M.game, M.workspace, M.players = game, ws, players
	return game
end

-- окружение для скрипта: глобалы Roblox + обычная библиотека
function M.env(scriptInst)
	local Instance = { new = function(class) return M.newInstance(class) end }
	local env = {
		game = M.game, workspace = M.workspace, script = scriptInst, task = task,
		Instance = Instance, Vector3 = M.Vector3, Vector2 = M.Vector2, CFrame = M.CFrame, Color3 = M.Color3,
		UDim = M.UDim, UDim2 = M.UDim2, TweenInfo = M.TweenInfo, Enum = M.Enum, RaycastParams = M.RaycastParams,
		ColorSequence = M.ColorSequence,
		print = function() end, warn = function(...) table.insert(M.warnings, table.concat({ ... }, " ")) end,
		os = { clock = function() return now end, time = function() return 1800000000 + math.floor(now) end },
	}
	env.require = function(mod)
		local d = D[mod]
		if d.loaded then return d.loaded end
		local fn = assert(loadstring(M.sources[d.name], "=" .. d.name))
		setfenv(fn, M.env(mod))
		d.loaded = fn()
		return d.loaded
	end
	return setmetatable(env, { __index = _G })
end
M.warnings = {}
function M.runScript(scriptInst)
	local fn = assert(loadstring(M.sources[D[scriptInst].name], "=" .. D[scriptInst].name))
	setfenv(fn, M.env(scriptInst))
	task.spawn(fn)
end
function M.find(root, pred)
	for _, x in ipairs(methods.GetDescendants(root)) do if pred(x, D[x]) then return x end end
	return nil
end
function M.findAll(root, pred)
	local out = {}
	for _, x in ipairs(methods.GetDescendants(root)) do if pred(x, D[x]) then table.insert(out, x) end end
	return out
end
M.D = D
return M
