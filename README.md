# OpenClaw Telegram 貼圖回覆插件（`tg-sticker-reply`）

OpenClaw 的 Telegram 外掛：貼圖庫（JSON）、CRUD 工具、`before_prompt_build` 提示。回覆貼圖仍須透過 OpenClaw 的 Telegram channel action（`action: "sticker"`），見官方文件：[Telegram 頻道：Stickers](https://docs.openclaw.ai/channels/telegram)。

## 需求條件

- **Node.js**：≥ 22（見 `package.json` 的 `engines`）
- **OpenClaw Gateway**：≥ `2026.5.0`（見 `package.json` 的 `openclaw.compat.minGatewayVersion`）
- **Telegram**：在設定中啟用貼圖動作：

```json5
channels: {
  telegram: {
    actions: {
      sticker: true,
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
  ],
},
```

3. **插件選項**（`plugins.entries.tg-sticker-reply.config`，欄位定義見 `openclaw.plugin.json` 的 `configSchema`）：

| 欄位 | 說明 |
|------|------|
| `maxCatalogLines` | 注入到 Telegram 提示的目錄列數上限（1–500，預設 40） |
| `enableStickerSearchHint` | 是否在提示中說明 sticker-search 後備（預設 `true`） |
| `migrateLegacyStickerMap` | 為 `true` 時，啟動把設定裡舊版 `stickerMap` 合併進 `data/sticker-library.json`（略過已存在的相同 `file_id`） |
| `stickerMap` | Legacy：`alias → file_id`，僅在 `migrateLegacyStickerMap` 為 `true` 時作為匯入來源 |

## 使用方式

- **貼圖庫檔案**：插件根目錄下 **`data/sticker-library.json`**（實際路徑依安裝位置而定）。建議備份 `data/`；勿將含敏感資料的庫檔提交到公開 repo（`.gitignore` 已忽略 `data/`）。
- **`tg_sticker_add`**：`fileId`、`meaning`；可選 `id`（slug）、`notes`。
- **`tg_sticker_list`**：列出 id、meaning、遮罩後的 `file_id`。
- **`tg_sticker_get`**：依 id 取得完整 `file_id`，供回覆中的 channel sticker action 使用。
- **`tg_sticker_update`**：更新某 id 的 `meaning` / `notes`。
- **`tg_sticker_remove`**：刪除某 id。

## 開發

```bash
npm install
npm run build
npm test
```

## 授權

見專案根目錄的 `LICENSE`。
