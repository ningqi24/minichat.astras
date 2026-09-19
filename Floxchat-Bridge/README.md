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

## ⚠️ 改扩展后必须重新打包 sb3

GitHub Pages 给 JS 的缓存头是 `cache-control: max-age=3600`（一小时）。
如果 `extensionURLs` 只是一个不带参数的地址，改完扩展后用户重开工程，
浏览器会直接用缓存里的旧 JS —— **改动看起来「没生效」**。

所以 `floxchat-patch.js` 里有个 `EXT_VER`，地址会拼成 `.../minichat-bridge.js?v=N`。
**每次改 `minichat-bridge.js` 就把 `EXT_VER` +1，并重新打包 sb3。**

> 另：探测新地址一定要等部署完成再探，否则「还没更新完」的响应会被 CDN 按那个
> 新 URL 缓存一小时 —— 我就这么把 `v=3` 探废过一次。

扩展连上时会在聊天里插一条 `[MiniChat 桥接 vN] 已连接…` 气泡，
看到它就知道浏览器拿到的是哪一版（也用来判断 sb3 有没有换成新的）。

## 扩展地址

```
https://minichat.astras.cc/Floxchat-Bridge/minichat-bridge.js
```

TurboWarp 里「加载扩展 → 从 URL」粘贴上面这行即可。

## 历史消息翻页（MiniChat 群）

FloxChat 的渲染是**只往尾部追加**的：

```
刷新数 = len(当前显示的群聊) - len(已显示消息)
重复 刷新数 次: i += 1 → 创建消息(当前显示的群聊[i]) → 等待 0.07 秒
```

所以**往前翻历史不能 unshift**（下标会全乱），正确做法是：

```
用 get_messages(limit, offset) 取上一页
   ↓ 服务端本来就是 created_at 倒序 + 支持 offset，不用改
整表替换「当前显示的群聊」
   ↓
广播一次「刷新消息」
   ↓ FloxChat 自己的处理器会把 已显示消息/消息长度/滑动页面/i 全归零
下一秒自动把这一页从头重画
```

**是累积的，不是替换窗口**：每次往前加载都把更早的一页并进列表，所以可以一直往回看
（上限 `FLOX_MAX_LOADED = 120` 条 —— 渲染 0.07 秒/条 + 每条约一组克隆体，再多就卡）。

**触发方式**（都不用加 UI、不用改 FloxChat 积木）：

| 方式 | 用法 |
|---|---|
| **自动** | 在群里往上滚一滚就自动加载更早的一页（扩展盯着 `滑动页面` 变量，带 3 秒冷却） |
| 输入框命令 | 发 `↑` / `..` / `/more` / `更早` → 加载更早；发 `↓` / `/latest` / `最新` → 回到最新 |
| 扩展积木 | `桥接往前翻一页更早的消息` / `桥接跳回最新一页消息` / `桥接已加载了多少条历史` / `桥接还有更早的历史可以加载？` |

> ⚠️ 两个坑（都踩过）：
> 1. **取页前必须先 `loadUsers()`** —— 否则 `avatarByEmail()` 是空的，头像 URL 全空，头像就不显示了。
> 2. **在 `getInfo` 里声明积木还不够**，实现必须挂到 `Scratch.extensions.register` 的那个对象上，
>    否则 Scratch 调用到的是 `undefined`。

> 为什么不做「一次加载全部」：三个硬瓶颈 ——
> ① 渲染每条消息要 `等待 0.07 秒`（1000 条 = 70 秒）；
> ② 每条消息生成一组克隆体，Scratch 克隆体默认上限 300；
> ③ 每条消息的 JSON 里都嵌一份头像 data URI。
> 所以走**窗口 + 翻页**，每页成本固定。

## 迁移到新版 FloxChat（一条命令）

```powershell
# 在项目根目录（放 build-floxchat.ps1 的那层）执行
.\build-floxchat.ps1 -Src "FloxChat Alpha 0.6.9_P2.5.1" -Tag "P2.5.1"
```

它会：复制源目录 → 打全部补丁 → 校验块图与资产 → 打包成 `FloxChat-<Tag>-MiniChat.sb3`。

也可以手动分步（与脚本等价）：

```bash
node floxchat-patch.js <原始 project.json> <输出 project.json>
node floxchat-validate.js <输出目录>
# 再把输出目录打包成 zip 并改名为 .sb3（project.json 必须在根）
```

> ⚠️ `build-floxchat.ps1` **必须保持纯 ASCII**。PowerShell 5.1 在没有 BOM 时按
> ANSI（中文系统是 GBK）读取 .ps1，文件里的中文会变乱码并可能直接把语法搞崩。

补丁清单写在 `floxchat-patch.js` 里每一段的上面，共 10 处。
已在 **FloxChat P2.4** 与 **FloxChat P2.5.1** 上验证通过。

### 为什么迁移成本低

`floxchat-patch.js` **不认任何块 ID**，只用结构特征定位，例如：
「找 `SUBSTACK` 首块是 `gsaHTTPRequests_clearAll` 的 `control_if`」。
所以 P2.5.1 时 8 个补丁是**一次全中**的。加上自动校验（块图一致性 + 资产完整性），
跑完就知道有没有打歪。

### 迁移新版时要额外留意的

| 类型 | 例子 | 处理 |
|---|---|---|
| **新增状态变量 / 渲染门闸** | P2.5.1 的 `当前实际显示的群聊` | 最容易漏！守卫会跳过它的赋值 → 补丁 3 需要在守卫外补一句 |
| 新增的服务器请求 | P2.5.1 的「退出群聊」POST | 用「扫描所有 `sendRequest`，看祖先条件」的办法找出来 → 补丁 9 |
| 服务端协议变化 | 登录从 `get_all` 改成 `get` | 影响的是字段顺序，逐项核对 `已登录用户信息` 的构造顺序 |
| 列表 / 变量改名 | — | 补丁会直接报「找不到列表 xxx」并中断，不会静默出错 |

> ⚠️ P2.5.1 在消息渲染前新增了一道闸：`当前显示的群聊ID == 当前实际显示的群聊`。
> 那个赋值原本在 HTTP 段里，会被补丁 3 的守卫跳过，所以补丁 3 额外在守卫外面补了一句同样的赋值。
> 老版本没有这个变量，脚本会自动跳过，不影响。
