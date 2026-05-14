# OpenClaw Telegram 貼圖回覆插件（`tg-sticker-reply`）

OpenClaw 的 Telegram 外掛：貼圖庫（JSON）、CRUD 工具、**`tg_sticker_send`（直接呼叫 Telegram `sendSticker`）**、`before_prompt_build` 提示。若不走工具，仍可選用 OpenClaw 的 channel action（`action: "sticker"`），見官方文件：[Telegram 頻道：Stickers](https://docs.openclaw.ai/channels/telegram)。

## 需求條件

- **Node.js**：≥ 22（見 `package.json` 的 `engines`）
- **OpenClaw Gateway**：≥ `2026.5.0`（見 `package.json` 的 `openclaw.compat.minGatewayVersion`）
- **Telegram**：建議仍啟用 `channels.telegram.actions.sticker`，以便在無法使用 `tg_sticker_send` 時走 **channel action** 後備路徑；僅使用 **`tg_sticker_send`** 直送時，理論上可不依賴該開關（繞過 OpenClaw 的 sticker action 解析）。

```json5
channels: {
  telegram: {
    actions: {
      sticker: true, // 後備：模型輸出 action: "sticker" 時需要
    },
  },
},
```

## 安裝

本專案為具備 `openclaw.plugin.json` 的外部插件，以 OpenClaw CLI 安裝（官方：[Plugin setup and config](https://docs.openclaw.ai/plugins/sdk-setup)、[Plugins 工具](https://docs.openclaw.ai/tools/plugin)）。

Gateway **不會**在插件目錄自動執行 `npm install` / 建置；請先在**插件根目錄**執行：

```bash
npm install
npm run build
```

確認已產生 **`dist/index.js`**（對應 `package.json` 的 `openclaw.runtimeExtensions`），再安裝：

**本機目錄**

```bash
openclaw plugins install /絕對或相對路徑/openclaw-tg-sticker
```

範例：

```bash
openclaw plugins install "$HOME/bear/openclaw-tg-sticker"
```

**本機 tarball（`npm pack`）**

```bash
npm run build
npm pack
openclaw plugins install ./higumalu-openclaw-tg-sticker-0.1.0.tgz
```

（檔名以 `npm pack` 實際輸出為準。）

安裝後若 CLI 要求重啟 Gateway，請依訊息重啟。

## 設定

1. **啟用插件**：在 OpenClaw 設定中啟用本插件，並於 `plugins.entries` 設定插件 id **`tg-sticker-reply`**（見 `openclaw.plugin.json`）。完整結構以 [Gateway 設定文件](https://docs.openclaw.ai/gateway/configuration) 為準。

2. **開放工具**（必要）：本插件註冊的工具為 **optional**，須在設定中明確允許，模型才能呼叫：

```json5
tools: {
  allow: [
    "tg_sticker_add",
    "tg_sticker_update",
    "tg_sticker_remove",
    "tg_sticker_list",
    "tg_sticker_get",
    "tg_sticker_send",
    "tg_sticker_import_pack",
    "tg_sticker_batch_update",
  ],
},
```

3. **插件選項**（`plugins.entries.tg-sticker-reply.config`，欄位定義見 `openclaw.plugin.json` 的 `configSchema`）：

| 欄位 | 說明 |
|------|------|
| `maxCatalogLines` | 注入到 Telegram 提示的目錄列數上限（1–500，預設 40） |
| `enableStickerSearchHint` | 是否在提示中說明 sticker-search 後備（預設 `true`） |
| `migrateLegacyStickerMap` | 為 `true` 時，啟動把設定裡舊版 `stickerMap` 合併進 `data/sticker-library.json`（略過已存在的相同 `file_id`） |
| `allowExplicitChatId` | 為 `true` 時，`tg_sticker_send` 可帶選填 `to`，但**必須與目前會話的 chat id 字串完全一致**（否則拒絕；預設為 `false`，只送 `deliveryContext.to`） |
| `botTokenOverride` | 選填：覆寫 Bot token；預設使用 **`channels.telegram`**（含多帳號 `accounts`）與 Gateway runtime 解析結果 |
| `stickerPromptNudge` | `prepend_reminder`（預設）：每回合在訊息前加一段短 **`prependContext`**，提醒模型先判斷是否呼叫 `tg_sticker_send`（較容易被遵守）。`system_only`：只注入長段系統政策（舊行為；部分模型會忽略而只回文字）。 |
| `sendStickerBodyEncoding` | `json`（預設）或 `form`：`tg_sticker_send` 呼叫 Bot API 時使用 JSON 或 **與 curl `-d` 相同**的 `application/x-www-form-urlencoded`（少數中介環境下可嘗試 `form`）。 |

**`tg_sticker_send` 說明**

- 使用 **Telegram Bot API** `sendSticker`：可傳貼圖庫條目的 **`id`**（解析庫內 `file_id`），或與 curl 相同直接傳 **`file_id`**（**必須是此 Bot 脈絡下**的 id，例如 OpenClaw `sticker-cache.json`／入站訊息中的值）。
- **`chat_id`** 預設僅允許目前工具上下文中的 **`deliveryContext.to`**（避免模型任意指定聊天室濫發）。
- 繞過 OpenClaw 的 sticker **action block** 解析鏈；**不會自動套用**主機對該路徑可能有的其他中介行為（取捨請自行評估）。

## `file_id` 與「同一個 Bot」（重要）

Telegram 的 **`file_id` 綁在 Bot 與取得情境上**：手動從**別的 Bot**、網路文章複製的 `file_id` 通常會送失敗。**公開貼圖包**請用 **`tg_sticker_import_pack`**（Bot API `getStickerSet`），取得的 `file_id` 可供**目前這台 Gateway 的 Bot** 用 `tg_sticker_send` 再送。

**建議流程（擇一）**

1. **公開貼圖包（推薦）**：用 **`tg_sticker_import_pack`**，貼上 `https://t.me/addstickers/<包名>`（例如 [t.me/addstickers/chikawa_meme](https://t.me/addstickers/chikawa_meme)）。外掛會呼叫 **`getStickerSet`** 一次寫入多張 `file_id`。匯入後的 **`meaning` 僅為佔位**（emoji／標題／序號），**無法**代表每張圖在對話裡的實際用法。
2. **在 OpenClaw 裡編修「每張怎麼用」**：請使用者用自然語言描述（例如「`pack_001` 打招呼、`pack_002` 敷衍回應」），由 Agent 對照 **`tg_sticker_list`** 的 **id**，呼叫 **`tg_sticker_batch_update`** 一次更新多筆 `meaning`，或 **`tg_sticker_update`** 改單筆。需要營運備註可寫 **`notes`**（語意與單筆更新相同）。
3. **單張自訂**：請使用者在 Telegram **轉傳貼圖給你的 Bot**（或讓 Bot 在已授權的聊天中看到該貼圖），從入站訊息取得 `file_id`，再用 **`tg_sticker_add`** 寫入庫（勿從網頁／別的 Bot 複製 `file_id`）。

第三方角色包（例如影片貼圖）：通常無法自行上架同款包；**若該包在 Telegram 上為公開連結**，優先使用 **`tg_sticker_import_pack`**；否則仍須依上述方式讓 **你的 Bot** 取得合法可重送的 `file_id`。

### `tg_sticker_send` 在工具列裡看不到、或 Agent 說不能用？

1. **`tools.allow`／`tools.alsoAllow`**：本外掛工具皆為 **optional**。若你使用 **`tools.profile: "messaging"`** 等較窄設定，預設**不會**自動帶入所有 plugin 工具；請在 `tools.allow` 或 **`tools.alsoAllow`** 中明確加入 **`tg_sticker_send`**（以及你需要的 `tg_sticker_import_pack` 等）。見 [OpenClaw 工具說明](https://docs.openclaw.ai/tools/index) 的 allow／profile 一節。
2. **`plugins.allow`**：若設定裡有 **`plugins.allow`** 白名單，**必須包含 `tg-sticker-reply`**，否則即使 `tools.allow` 寫了工具名，外掛也不會載入（見 [Plugin 設定](https://docs.openclaw.ai/tools/plugin)）。
3. **Gateway 是否重載**：安裝或修改外掛後需 **`npm run build`** 並讓 **Gateway 行程**重啟或觸發 plugin reload；本機編輯的設定檔與遠端 Gateway 不一致時，Agent 會以為沒有該工具。
4. **除錯指令**：`openclaw plugins inspect tg-sticker-reply --runtime --json` 確認已註冊的工具名稱；`openclaw gateway status --deep` 確認連到的 Gateway 與設定檔路徑。
5. **與 curl 對齊**：若模型已有 **`file_id`**（例如主機 `~/.openclaw/telegram/sticker-cache.json`），可改用 **`tg_sticker_send` 的 `fileId` 參數**（不必先寫入貼圖庫）；HTTP 編碼可設 **`sendStickerBodyEncoding: "form"`** 以貼近 curl `-d`。

**請勿在聊天室或 issue 貼出完整 Bot token**；若已外洩，請到 [@BotFather](https://t.me/BotFather) 旋轉 token。

### 模型都只回文字、不送貼圖？

1. 確認 **`tools.allow` 含 `tg_sticker_send`**（optional 工具未允許時，模型看不到也無法呼叫）。
2. 確認貼圖庫 **`data/sticker-library.json` 至少有一筆**，且 `meaning` 與使用者語氣有對得上；否則政策會請模型跳過貼圖。
3. 將 **`stickerPromptNudge` 設為 `prepend_reminder`**（預設）：會多一段置頂短提醒，通常比單靠長系統段落有效。

## 使用方式

- **貼圖庫檔案**：插件根目錄下 **`data/sticker-library.json`**（實際路徑依安裝位置而定）。建議備份 `data/`；勿將含敏感資料的庫檔提交到公開 repo（`.gitignore` 已忽略 `data/`）。
- **`tg_sticker_import_pack`**：`stickerSetLinkOrName`（`https://t.me/addstickers/<name>` 或包名）、可選 `maxStickers`（1–200，預設 100）。需 **`tools.allow`** 含此工具與有效 **`channels.telegram` bot token**。
- **`tg_sticker_add`**：`fileId`、`meaning`；可選 `id`（slug）、`notes`（適合單張、或轉傳取得的 `file_id`）。
- **`tg_sticker_list`**：列出 id、meaning、遮罩後的 `file_id`（編修用法前先查 id）。
- **`tg_sticker_batch_update`**：`updates` 陣列（最多 50 筆），每筆 `{ id, meaning?, notes? }`；適合匯入圖包後批次寫入「何時該用哪張」。
- **`tg_sticker_get`**：依 id 取得完整 `file_id` 與 meaning。
- **`tg_sticker_send`**：傳 **`id`**（庫內條目）**或** **`file_id`**（此 Bot 的 raw id，對齊 curl）；對**目前 Telegram 會話**送出（優先於 channel action）。可搭配 **`sendStickerBodyEncoding: "form"`**。
- **`tg_sticker_update`**：更新單一 id 的 `meaning` / `notes`。
- **`tg_sticker_remove`**：刪除某 id。

## 開發

```bash
npm install
npm run build
npm test
```

## 授權

見專案根目錄的 `LICENSE`。
