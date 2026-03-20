# opencode-notify

把 OpenCode 的关键事件推送到 `notify.milki.top`，包括提问、权限申请、报错和回复完成。

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
2. 在启动 OpenCode 的同一个 shell 里设置 token：

```bash
export OPENCODE_NOTIFY_TOKEN="你的通知 token"
```

3. 如果你需要覆盖默认值，可以继续设置这些环境变量：

```bash
export OPENCODE_NOTIFY_API_URL="https://notify.milki.top/api/v2/message/send"
export OPENCODE_NOTIFY_TITLE="OpenCode"
export OPENCODE_NOTIFY_PREVIEW_LIMIT="30"
```

4. 把插件路径加入 `~/.config/opencode/opencode.jsonc`：

```jsonc
{
  "plugin": [
    "file:///ABSOLUTE/PATH/TO/opencode-notify/index.mjs"
  ]
}
```

如果你已经配置了其他插件，请把这一项追加到原有数组里，不要整段覆盖。

5. 检查配置是否生效：

```bash
opencode debug config
```

输出里的 `plugin` 数组应当包含这条 `file:///.../index.mjs` 路径。

## 配置说明

| 环境变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `OPENCODE_NOTIFY_TOKEN` | 是 | - | `notify.milki.top` 提供的 token |
| `OPENCODE_NOTIFY_API_URL` | 否 | `https://notify.milki.top/api/v2/message/send` | 通知 API 地址 |
| `OPENCODE_NOTIFY_TITLE` | 否 | `OpenCode` | 通知标题后缀 |
| `OPENCODE_NOTIFY_PREVIEW_LIMIT` | 否 | `30` | 预览文本最大长度 |

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
- 请把 `OPENCODE_NOTIFY_TOKEN` 放在 shell 配置、密钥管理器或服务环境变量里。
- 如果 token 泄漏，请先轮换再继续使用本仓库。

## 文件说明

- `index.mjs`：插件入口与事件钩子
- `opencode.example.jsonc`：最小配置示例
- `package.json`：仓库元信息与检查脚本
