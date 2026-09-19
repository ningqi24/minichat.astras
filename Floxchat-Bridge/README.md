# Floxchat-Bridge

把 **MiniChat** 接进 **FloxChat** 的文件都收在这个目录里。

## 文件

| 文件 | 说明 |
|---|---|
| `minichat-bridge.js` | TurboWarp 扩展。给 FloxChat 提供「连接 MiniChat / 收发消息 / 把 MiniChat 群聊写进 FloxChat 列表」等积木 |
| `minichat-avatar-150.svg` | FloxChat 群聊列表里 MiniChat 条目的头像。**150×150 圆形**（CloChat 的头像规格，蓝色圆底 + 白色 Logo） |
| `floxchat-patch.js` | 给 FloxChat 工程打补丁、生成「带 MiniChat 群聊」的 sb3 |
| `floxchat-validate.js` | 补丁后的块图一致性 / 资产完整性校验 |

## 头像尺寸怎么定的

FloxChat 的群头像克隆体用的是 `set size to N%`，**N% 是相对图片自然尺寸的百分比**，
所以图片本身多大直接决定它显示多大。站点原来的 `assets/logo.svg` 只有 40×44px，
渲染出来只有别的群头像的 1/3 不到，看着像个小点。

实测下来 **136px 高** 和 FloxChat 其他群头像大小相当。想再调就改两处：

- `minichat-avatar-150.svg` 里的圆半径和图形 `scale()` 倍数
- `floxchat-patch.js` 里的 `GAVATAR` 常量

⚠️ 两个坑（都踩过了）：

1. **`width`/`height` 必须始终等于 `viewBox`**（Scratch 的约定）。放大要靠在外面套一层
   `<g transform="scale(S)">`，只改 `width`/`height` 会让 `scratch-svg-renderer`
   按新画布建皮肤、却仍按旧坐标画图形，结果只显示左上角一小块。
2. `rotationCenter` 注释也要按同一倍数缩放。

## 群聊 ID 规范

FloxChat 的群聊 ID **统一 7 位**（`GID`+4 位数字，以及 `FLOXGRP` / `SAYLINK` 这两个特例）。

MiniChat 这个群是纯本地哨兵（不经过 FloxChat 服务器），但照样按 7 位取：

```
MINCHAT
```

要改就在 `floxchat-patch.js` 的 `GID` 和 `minichat-bridge.js` 的 `FLOX_GID` 两处一起改。

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
已在 **FloxChat P2.4** 与 **FloxChat P2.5.1** 上验证通过。

> ⚠️ P2.5.1 在消息渲染前新增了一道闸：`当前显示的群聊ID == 当前实际显示的群聊`。
> 那个赋值原本在 HTTP 段里，会被补丁 3 的守卫跳过，所以补丁 3 额外在守卫外面补了一句同样的赋值。
> 老版本没有这个变量，脚本会自动跳过，不影响。
