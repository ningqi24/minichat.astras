# Floxchat-Bridge

把 **MiniChat** 接进 **FloxChat** 的文件都收在这个目录里。

## 文件

| 文件 | 说明 |
|---|---|
| `minichat-bridge.js` | TurboWarp 扩展。给 FloxChat 提供「连接 MiniChat / 收发消息 / 把 MiniChat 群聊写进 FloxChat 列表」等积木 |
| `minichat-logo-300.svg` | FloxChat 群聊列表里 MiniChat 条目的头像。300px 高，和 FloxChat 默认群头像（300×300）同尺寸，否则会被 `set size` 缩得极小。⚠️ 注意 `width`/`height` 必须等于 `viewBox`（Scratch 的约定），放大要用内层 `scale()`，不能只改 width/height |
| `floxchat-patch.js` | 给 FloxChat 工程打补丁、生成「带 MiniChat 群聊」的 sb3 |
| `floxchat-validate.js` | 补丁后的块图一致性 / 资产完整性校验 |

## 扩展地址

```
https://minichat.astras.cc/Floxchat-Bridge/minichat-bridge.js
```

TurboWarp 里「加载扩展 → 从 URL」粘贴上面这行即可。

## 重新打补丁（FloxChat 发新版时）

```bash
# 1. 把 FloxChat 的 sb3 解压，拿到 project.json
node floxchat-patch.js <原始 project.json> <输出 project.json>
node floxchat-validate.js <输出目录>
# 2. 把输出目录重新打包成 .sb3（zip 即可，project.json 必须在根）
```

补丁清单写在 `floxchat-patch.js` 里每一段的上面，共 8 处。
