-- The Carry Tavern Roblox verification game
-- Put this Script in ServerScriptService in the published verification place.
-- In Game Settings -> Security, enable Allow HTTP Requests.
-- In Creator Dashboard -> your experience -> Secrets, create a secret named:
-- CarryTavernVerificationSecret
-- Its value must exactly match the Cloudflare ROBLOX_VERIFICATION_GAME_SECRET.

local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")

local API_URL = "https://carry-tavern.davidtennyson846.workers.dev/api/roblox/game-verify"
local GAME_SECRET_NAME = "CarryTavernVerificationSecret"

local function showStatus(player, titleText, bodyText)
	local playerGui = player:FindFirstChildOfClass("PlayerGui")
	if not playerGui then
		return
	end

	local old = playerGui:FindFirstChild("CarryTavernVerification")
	if old then
		old:Destroy()
	end

	local gui = Instance.new("ScreenGui")
	gui.Name = "CarryTavernVerification"
	gui.ResetOnSpawn = false
	gui.IgnoreGuiInset = true
	gui.Parent = playerGui

	local frame = Instance.new("Frame")
	frame.AnchorPoint = Vector2.new(0.5, 0.5)
	frame.Position = UDim2.fromScale(0.5, 0.5)
	frame.Size = UDim2.fromOffset(520, 230)
	frame.BackgroundColor3 = Color3.fromRGB(24, 18, 12)
	frame.BackgroundTransparency = 0.08
	frame.BorderSizePixel = 0
	frame.Parent = gui

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 16)
	corner.Parent = frame

	local stroke = Instance.new("UIStroke")
	stroke.Color = Color3.fromRGB(208, 160, 72)
	stroke.Thickness = 2
	stroke.Transparency = 0.15
	stroke.Parent = frame

	local title = Instance.new("TextLabel")
	title.BackgroundTransparency = 1
	title.Position = UDim2.fromOffset(28, 30)
	title.Size = UDim2.new(1, -56, 0, 55)
	title.Font = Enum.Font.GothamBold
	title.Text = titleText
	title.TextColor3 = Color3.fromRGB(240, 194, 92)
	title.TextScaled = true
	title.Parent = frame

	local body = Instance.new("TextLabel")
	body.BackgroundTransparency = 1
	body.Position = UDim2.fromOffset(34, 100)
	body.Size = UDim2.new(1, -68, 0, 90)
	body.Font = Enum.Font.Gotham
	body.Text = bodyText
	body.TextColor3 = Color3.fromRGB(240, 236, 226)
	body.TextWrapped = true
	body.TextScaled = true
	body.Parent = frame
end

local function verifyPlayer(player)
	showStatus(player, "🍺 Verifying...", "Checking your Roblox account with The Carry Tavern. Do not leave yet.")

	local success, response = pcall(function()
		local gameSecret = HttpService:GetSecret(GAME_SECRET_NAME)
		return HttpService:RequestAsync({
			Url = API_URL,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["x-api-key"] = gameSecret,
			},
			Body = HttpService:JSONEncode({
				robloxUserId = tostring(player.UserId),
			}),
		})
	end)

	if not success then
		warn("[Carry Tavern Verify] HTTP request failed:", response)
		showStatus(player, "⚠️ Verification failed", "The verification server could not be reached. Rejoin in a moment or contact Tavern staff.")
		return
	end

	local decoded
	local decodeSuccess = pcall(function()
		decoded = HttpService:JSONDecode(response.Body)
	end)

	if response.Success and decodeSuccess and decoded and decoded.verified then
		player:SetAttribute("CarryTavernVerified", true)
		showStatus(player, "✅ VERIFIED", "Your Roblox account is now linked to The Carry Tavern. You can leave the game and return to Discord.")
		return
	end

	local reason = "No pending verification was found for this Roblox account. Run /roblox link in Discord first, then rejoin."
	if decodeSuccess and decoded and decoded.error then
		reason = tostring(decoded.error)
	end
	warn("[Carry Tavern Verify] Verification rejected:", response.StatusCode, reason)
	showStatus(player, "❌ Not verified", reason)
end

Players.PlayerAdded:Connect(function(player)
	task.spawn(verifyPlayer, player)
end)

for _, player in Players:GetPlayers() do
	task.spawn(verifyPlayer, player)
end
