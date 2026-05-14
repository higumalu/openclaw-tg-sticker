# OpenClaw Telegram 貼圖回覆插件（`tg-sticker-reply`）

> **從 GitHub 安裝／設定要點**：請先看 **[OPENCLAW.md](./OPENCLAW.md)**（一頁：建置、CLI 安裝、設定、驗證指令）。

本插件把 Telegram 貼圖拆成兩件事：**貼圖庫（存與改）**、**在對話裡送出去（OpenClaw 行為）**。不走工具時，仍可選 OpenClaw 的 channel action（`action: "sticker"`），見 [Telegram 頻道：Stickers](https://docs.openclaw.ai/channels/telegram)。

---

## 架構：兩條線

| 類別 | 在做什麼 | 主要手段 |
|------|----------|----------|
| **一、存入／編輯貼圖** | 維護一份可給模型看的「目錄」：`id`、`meaning`、此 Bot 可用的 `file_id` | 貼圖庫 JSON + CRUD／匯入工具 |
| **二、讓 OpenClaw 發送貼圖** | 在 **Telegram 會話**裡真的送出貼圖（或後備 action） | `tg_sticker_send`、提示詞注入、可選 channel `sticker` |

以下分開說明。

---

## 一、存入與編輯貼圖（貼圖庫）

**資料在哪裡**

- 庫檔：**`data/sticker-library.json`**（路徑相對於插件安裝根目錄；`.gitignore` 已忽略 `data/`，請自行備份）。

**怎麼把貼圖放進庫裡**

1. **公開貼圖包（推薦）**：**`tg_sticker_import_pack`** — 貼 `https://t.me/addstickers/<包名>` 或包名。會呼叫 Bot API **`getStickerSet`**，一次寫入多筆此 Bot 可用的 `file_id`（不必使用者逐張轉傳）。
2. **單張**：**`tg_sticker_add`** — 使用者把貼圖**轉傳給你的 Bot**，從入站 payload 取 `file_id`，再寫入庫；勿從網頁或別的 Bot 複製 `file_id`（通常會失敗）。

**`file_id` 與「同一個 Bot」**

- `file_id` **綁定 Bot 與情境**；只有**目前 Gateway 連的這台 Bot** 能穩定再送。**公開包**用 `getStickerSet` 匯入即可；單張則依轉傳／入站取得。

**匯入後為什麼還要編輯**

- 圖包匯入後的 **`meaning` 多半是佔位**（標題／emoji／序號），模型無法從中知道「對話裡何時該用哪一張」。
- **編修**：使用者用自然語言說明用途 → Agent 對照 **`tg_sticker_list`** 的 **id**，呼叫 **`tg_sticker_batch_update`**（多筆）或 **`tg_sticker_update`**（單筆）寫入 `meaning`／`notes`。

**常用工具（庫相關）**

| 工具 | 用途 |
|------|------|
| `tg_sticker_import_pack` | 從 `t.me/addstickers/...` 或包名批次匯入 |
| `tg_sticker_add` | 單筆註冊（`fileId` + `meaning`，可選 `id`／`notes`） |
| `tg_sticker_list` | 列目錄（遮罩 `file_id`） |
| `tg_sticker_get` | 依 `id` 取完整 `file_id` 與 `meaning`／`notes` |
| `tg_sticker_batch_update` | 最多 50 筆 `{ id, meaning?, notes? }` 批次改 metadata |
| `tg_sticker_update` | 單筆改 `meaning`／`notes` |
| `tg_sticker_remove` | 依 `id` 刪除 |

---

## 二、讓 OpenClaw 發送貼圖

**主路徑：Bot API 工具**

- **`tg_sticker_send`**：對**目前 Telegram 工具上下文**的 **`deliveryContext.to`** 呼叫 **`sendSticker`**。
  - 參數擇一：**`id`**（庫內條目）或 **`fileId`**（此 Bot 的 raw id，例如主機 `sticker-cache`／入站，行為對齊 curl）。
  - 需能解析 **`channels.telegram` bot token**（或插件 **`botTokenOverride`**）。
  - 插件設定 **`sendStickerBodyEncoding`**：`json`（預設）或 **`form`**（`application/x-www-form-urlencoded`，等同 curl `-d`）。

**後備：OpenClaw channel action**

- 模型輸出可解析的 **`action: "sticker"`** 區塊時，由主機處理；需 **`channels.telegram.actions.sticker: true`**。與 **`tg_sticker_send` 擇一**，同一回合不要雙送。

**模型怎麼「想得起來」要送貼圖**

- **`before_prompt_build`**（僅 `messageProvider === "telegram"`）：注入目錄與政策（**`appendSystemContext`**，可選 **`prependContext`** 短提醒）。
- 插件選項 **`stickerPromptNudge`**：`prepend_reminder`（預設）或 `system_only`。

**工具列裡沒有 `tg_sticker_send`？**

- **`tg_sticker_send`** 在 manifest 為 **預設外掛工具**（`optional: false`），一般較容易出現在清單；若要關閉送出，用 **`tools.deny`**。
- 其餘 **`tg_sticker_*` 多為 optional**：若 allowlist 極窄，需明列工具名或加 **`"*"`**／**`group:plugins`**；且 **`plugins.allow`** 若有設，必須包含 **`tg-sticker-reply`**（`*` 不能繞過）。見 [Gateway doctor](https://docs.openclaw.ai/gateway/doctor)、[Plugin 工具](https://docs.openclaw.ai/tools/plugin)。
- Workspace 外掛請確認 **`plugins.entries.tg-sticker-reply.enabled: true`**；改碼後 **`npm run build`** 並重啟 Gateway。除錯：`openclaw plugins inspect tg-sticker-reply --runtime --json`、`openclaw gateway status --deep`。

**模型都只回文字？**

- 確認 **`tools.deny`** 未擋 `tg_sticker_send`；allowlist 有放行相關工具。
- 庫裡 **`meaning`** 要對得上使用者語氣（匯入後務必編修）。
- **`stickerPromptNudge: prepend_reminder`**（預設）有助模型遵守。

**請勿在聊天室或 issue 貼出完整 Bot token**；若已外洩，請到 [@BotFather](https://t.me/BotFather) 旋轉 token。

---

## 需求條件

- **Node.js**：≥ 22（見 `package.json` 的 `engines`）
- **OpenClaw Gateway**：≥ `2026.5.0`（見 `package.json` 的 `openclaw.compat.minGatewayVersion`）
- **Telegram**：建議啟用 `channels.telegram.actions.sticker` 作為 **channel action** 後備。

```json5
channels: {
  telegram: {
    actions: {
      sticker: true, // 後備：action: "sticker" 時需要
    },
  },
},
```

---

## 安裝

本專案為具備 `openclaw.plugin.json` 的外部插件（[Plugin setup and config](https://docs.openclaw.ai/plugins/sdk-setup)、[Plugins 工具](https://docs.openclaw.ai/tools/plugin)）。

Gateway **不會**在插件目錄自動 `npm install`／建置；請在**插件根目錄**：

```bash
npm install
npm run build
```

確認已產生 **`dist/index.js`** 後再安裝：

```bash
openclaw plugins install /絕對或相對路徑/openclaw-tg-sticker
# 範例：
openclaw plugins install "$HOME/bear/openclaw-tg-sticker"
```

**tarball**：`npm pack` 後 `openclaw plugins install ./<packname>.tgz`。安裝後依 CLI 提示重啟 Gateway。

---

## 設定

1. **啟用插件**：`plugins.entries` 內插件 id **`tg-sticker-reply`**（見 [Gateway 設定](https://docs.openclaw.ai/gateway/configuration)）。
2. **工具白名單**：依你的 **`tools.profile`／`tools.allow`／`tools.alsoAllow`** 放行本插件工具（庫類多為 optional；**`tg_sticker_send`** 為預設外掛工具）。範例：

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

3. **插件選項**（`plugins.entries.tg-sticker-reply.config`，完整 schema 見 `openclaw.plugin.json`）：

| 欄位 | 說明 |
|------|------|
| `maxCatalogLines` | 注入 Telegram 提示的目錄列數上限（1–500，預設 40） |
| `enableStickerSearchHint` | 是否在提示中說明 sticker-search 後備（預設 `true`） |
| `migrateLegacyStickerMap` | `true` 時啟動把設定裡舊 `stickerMap` 合併進庫 |
| `allowExplicitChatId` | `true` 時 `tg_sticker_send` 可選填 `to`，但須與 **`deliveryContext.to`** 完全一致 |
| `botTokenOverride` | 覆寫 Bot token；預設用 **`channels.telegram`** |
| `stickerPromptNudge` | `prepend_reminder`（預設）或 `system_only` |
| `sendStickerBodyEncoding` | `json`（預設）或 `form`（curl `-d` 風格） |

---

## 開發

```bash
npm install
npm run build
npm test
```

## 授權

見專案根目錄的 `LICENSE`。
