# opencode-notify

把 OpenCode 的关键事件推送到 `notify.milki.top`，包括提问、权限申请、报错和回复完成。

现在插件已经支持通过独立配置文件保存 `token`、`apiUrl`、`title` 和 `previewLimit`，不一定要再放环境变量里。

## 功能

- `question.asked`：发送提问预览
- `permission.ask`：发送权限申请内容
- `session.error`：发送错误名称或错误信息
- `session.idle`：使用本轮最新回复文本发送完成通知

插件会按会话去重完成通知，避免同一段回复因为重复 `session.idle` 事件被反复推送。

## 运行要求

- 支持插件加载的 OpenCode
- Node.js 20+
- `notify.milki.top` 的有效 token

## 安装步骤

1. 克隆本仓库到本地目录。
2. 把插件路径加入 `~/.config/opencode/opencode.jsonc`：

```jsonc
{
  "plugin": [
    "file:///ABSOLUTE/PATH/TO/opencode-notify/index.mjs"
  ]
}
```

如果你已经配置了其他插件，请把这一项追加到原有数组里，不要整段覆盖。

3. 任选一种方式配置通知参数。

方式 A：全局配置文件，推荐放在 `~/.config/opencode/opencode-notify.jsonc`

```jsonc
{
  "token": "your-notify-token",
  "apiUrl": "https://notify.milki.top/api/v2/message/send",
  "title": "OpenCode",
  "previewLimit": 30
}
```

方式 B：项目级配置文件，放在当前项目根目录，例如 `PROJECT_ROOT/.opencode-notify.jsonc`

```jsonc
{
  "token": "your-notify-token"
}
```

方式 C：环境变量，适合 CI 或不想落盘时使用：

```bash
export OPENCODE_NOTIFY_TOKEN="你的通知 token"
```

如果你需要覆盖默认值，可以继续设置这些环境变量：

```bash
export OPENCODE_NOTIFY_API_URL="https://notify.milki.top/api/v2/message/send"
export OPENCODE_NOTIFY_TITLE="OpenCode"
export OPENCODE_NOTIFY_PREVIEW_LIMIT="30"
```

4. 检查配置是否生效：

```bash
opencode debug config
```

输出里的 `plugin` 数组应当包含这条 `file:///.../index.mjs` 路径。

## 配置优先级

插件按下面的顺序合并配置，越靠后优先级越高：

- 全局配置文件：`~/.config/opencode/opencode-notify.json` / `~/.config/opencode/opencode-notify.jsonc`
- 项目配置文件：`PROJECT_ROOT/.opencode-notify.json` / `PROJECT_ROOT/.opencode-notify.jsonc`
- 自定义路径：`OPENCODE_NOTIFY_CONFIG=/path/to/config.jsonc`
- 单项环境变量：`OPENCODE_NOTIFY_TOKEN`、`OPENCODE_NOTIFY_API_URL`、`OPENCODE_NOTIFY_TITLE`、`OPENCODE_NOTIFY_PREVIEW_LIMIT`

也就是说，你完全可以把常用 token 放在配置文件里，只有临时覆盖时再用环境变量。

## 为什么不是直接写进 `opencode.jsonc`

浮浮酱已经验证过，OpenCode 主配置会校验未知顶层字段；像 `opencodeNotify` 这样的自定义 key 会直接报 `Unrecognized key`。所以这里采用独立配置文件方案，兼容性更稳。

## 配置说明

| 字段 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `token` / `OPENCODE_NOTIFY_TOKEN` | 是 | - | `notify.milki.top` 提供的 token |
| `apiUrl` / `OPENCODE_NOTIFY_API_URL` | 否 | `https://notify.milki.top/api/v2/message/send` | 通知 API 地址 |
| `title` / `OPENCODE_NOTIFY_TITLE` | 否 | `OpenCode` | 通知标题后缀 |
| `previewLimit` / `OPENCODE_NOTIFY_PREVIEW_LIMIT` | 否 | `30` | 预览文本最大长度 |

## 本地校验

先跑一次导入检查：

```bash
npm run check
```

然后在 OpenCode 里触发任意一种场景：

- 让 OpenCode 主动向你提问
- 让 OpenCode 申请权限
- 等待一轮回复完成

## 安全说明

- 不要把真实 token 提交到仓库里。
- 如果使用配置文件，请把它放在 `~/.config/opencode/` 或项目本地并加入忽略规则。
- 如果不想落盘，请继续使用 `OPENCODE_NOTIFY_TOKEN` 环境变量。
- 如果 token 泄漏，请先轮换再继续使用本仓库。

## 文件说明

- `index.mjs`：插件入口与事件钩子
- `opencode.example.jsonc`：最小配置示例
- `opencode-notify.config.example.jsonc`：通知配置示例
- `package.json`：仓库元信息与检查脚本
