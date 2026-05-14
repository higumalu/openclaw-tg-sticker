# OpenClaw 外掛：一頁看懂怎麼裝、怎麼用

本 repo 是 OpenClaw **原生外掛**（`openclaw.plugin.json`），插件 id：**`tg-sticker-reply`**。從 GitHub 進來時，依下面順序即可；細節與架構說明見根目錄 **[README.md](./README.md)**。

## 你需要什麼環境

- **Node.js** ≥ 22  
- **OpenClaw Gateway** ≥ `2026.5.0`（與本 repo `package.json` / `openclaw.plugin.json` 相容宣告一致）  
- 官方文件：[Plugin setup and config](https://docs.openclaw.ai/plugins/sdk-setup)、[安裝與設定 Plugins](https://docs.openclaw.ai/tools/plugin)、[Gateway 設定](https://docs.openclaw.ai/gateway/configuration)

## 安裝（必做：先建置再裝）

Gateway **不會**在插件目錄自動跑 `npm install`／編譯，請在**本機 clone 後的插件根目錄**執行：

```bash
cd /path/to/openclaw-tg-sticker
npm install
npm run build
```

確認已產生 **`dist/index.js`**（對應 `package.json` 的 `openclaw.runtimeExtensions`）。

再交給 OpenClaw CLI 安裝（擇一）：

```bash
# 本機目錄
openclaw plugins install /絕對或相對路徑/openclaw-tg-sticker

# 或從 Git（版本 tag／branch 請自行替換）
openclaw plugins install git:github.com/<owner>/openclaw-tg-sticker@main
```

安裝後依 CLI 提示 **重啟 Gateway**（或 `openclaw gateway restart`）。原始碼變更後需重新 `npm run build` 並再重啟／reload。

驗證是否載入：

```bash
openclaw plugins inspect tg-sticker-reply --runtime --json
```

## OpenClaw 設定裡要加什麼

1. **啟用插件**（`plugins.entries`）：插件 id **`tg-sticker-reply`**，Workspace 來源的外掛通常還要 **`enabled: true`**。  
2. **`plugins.allow`**：若你的設定裡有 **非空的** `plugins.allow` 白名單，必須包含 **`tg-sticker-reply`**，否則工具不會載入（與 `tools.allow: ["*"]` 無關）。見 [Gateway doctor](https://docs.openclaw.ai/gateway/doctor) 說明。  
3. **工具白名單**：依 `tools.profile`／`tools.allow`／`tools.alsoAllow` 放行本插件工具。庫相關工具多為 **optional**；**`tg_sticker_send`** 在本 manifest 為 **預設外掛工具**（較容易出現在工具列）。範例：

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

4. **Telegram**：需設定 **`channels.telegram`**（`botToken` 或 `accounts`），`tg_sticker_send`／`tg_sticker_import_pack` 才能解析 token。建議仍開 **`channels.telegram.actions.sticker`** 作為 channel action 後備（見 README）。

插件專用選項寫在 **`plugins.entries.tg-sticker-reply.config`**，欄位以 **`openclaw.plugin.json`** 的 `configSchema` 為準。

## 使用方式（兩句話）

| 想做什麼 | 做什麼 |
|----------|--------|
| **把貼圖存進庫、改說明** | `tg_sticker_import_pack`（公開包連結）或 `tg_sticker_add`（轉傳取得的 `file_id`）；再用 `tg_sticker_list`／`tg_sticker_batch_update`／`tg_sticker_update` 編 `meaning` |
| **在 Telegram 裡送出貼圖** | 模型在 Telegram 會話中呼叫 **`tg_sticker_send`**（`id` 或 `fileId`）；或由主機處理 **`action: "sticker"`** 後備 |

完整工具表、`file_id` 與同一 Bot、除錯與模型行為見 **[README.md](./README.md)**。

## 相關連結

- [Telegram 頻道：Stickers（OpenClaw）](https://docs.openclaw.ai/channels/telegram)  
- [Telegram Bot API：sendSticker](https://core.telegram.org/bots/api#sendsticker)、[getStickerSet](https://core.telegram.org/bots/api#getstickerset)
