# dsh-model-palette

DeepSeek Harness（DSH）插件：`Ctrl+L` 唤出键盘驱动的模型速选面板，一键切换会话模型与推理（思考）强度。

> A keyboard-driven model & reasoning-effort palette plugin for [DeepSeek Harness](https://www.deepseek.com/harness/).

## 功能

- **模型速选** — 按 provider 分组列出当前会话可用模型，输入即时过滤，`↑↓` 选择、`Enter` 确认、`Esc` 关闭；数据与输入框模型按钮、`/model` 指令同源（ModelDirectory），切换后处处同步。
- **推理强度** — 选择声明了推理等级的模型后自动进入二级面板，可切换「跟随默认 / Low / High / Max …」；对当前模型直接换等级走的是官方同款 thinking-level 切换路径。
- **状态可见** — 当前模型带 ✓ 并显示生效强度，等待切换时显示 pending 点，目录加载失败单独成行提示。
- **快捷键可重绑** — 在 设置 → 快捷键 中修改（命令 id `modelPalette.open`）。
- **多语言** — 跟随 DSH 界面语言（zh / en / ja / …）。

## 快捷键

| 环境 | 默认键 |
|---|---|
| 桌面应用（macOS / Windows / Linux） | `Ctrl+L` |
| 浏览器 macOS | `⌘⌥L` |
| 浏览器 Windows | `Ctrl+Alt+L` |
| 浏览器 Linux | 无默认键位，可从指令面板搜索「选择模型」触发 |

> 浏览器端组合键受 DSH Web 快捷键策略约束（双修饰键必须包含平台主键），因此 macOS 上是 ⌘⌥L 而不是 Ctrl+L。任一模态框打开期间，快捷键按设计被拦截。

## 安装

零依赖、无构建步骤，clone 即用：

```bash
git clone https://github.com/A-Zee029/dsh-model-palette.git
```

编辑 `~/.dsh/profiles/desktop/package.json`，把插件加入 profile 依赖并注册到 bundles（`link:` 指向 clone 出来的目录）：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "…",
        "@local/dsh-model-palette"
      ]
    }
  },
  "dependencies": {
    "@local/dsh-model-palette": "link:/path/to/dsh-model-palette"
  }
}
```

重启 DSH（或等待 profile 热重载）即可生效。请保持包名为 `@local/dsh-model-palette`：插件的 client 模块 id 与 bundle 补丁都以这个名字注册。

## 工作原理

- **Node 半侧**：`package.json` 通过 `dsh.bundle.patch` 声明 `cordis.patch.yml`（向 profile bundle `insert:` 一个条目），`dsh.client` 声明 web 端立即加载并注入 `@deepseek-ai/dsh-client-ui-conversation`。
- **Client 侧**：`window.__ModuleLoader__.load(...)` 注册 `shell.overlay` 面板、`conversation.composer.dock` 会话捕获、`shortcuts.register` 快捷键与 locale 词典；模型与推理等级数据全部来自会话共享的 ModelDirectory，插件自身不做任何 RPC。
- `apply()` 按防御式风格分五步（locale → shortcut → styles → dock → overlay），任一步失败只记录该步错误，不影响其余步骤。

## 环境

- DeepSeek Harness 0.2.2-rc.3+（开发与测试版本）

## License

[MIT](LICENSE)
