# tools/emoji-split

MiniChat 表情数据的拆分工具。把「一整包」表情数据拆成按分类懒加载的分片。

## 为什么有这个东西

原来聊天页一打开就并行拉两个文件：

| 文件 | 大小 |
|---|---|
| `data/emojihub-all.json` | 249 KB |
| `data/kaomoji.json` | 1388 KB |
| **合计** | **约 1.6 MB** |

和用户是否使用表情面板**完全无关** —— 每次打开聊天页都在白拉 1.6 MB。

现在改成：

| 时机 | 拉什么 | 大小 |
|---|---|---|
| 页面加载 | **什么都不拉** | 0 |
| 首次打开表情面板 | `data/emoji-index.json` | 3.7 KB |
| 点击某个分类 | 那一个分类的文件 | 2.1 ~ 183.6 KB |

共 **29 个分类**（8 个 emoji + 21 个颜文字大类）。

## 文件说明

- `merge-rules.json` —— 颜文字归类规则，格式 `[["大类名", ["关键词", ...]], ...]`。
  按分类名的小写**子串**匹配，**规则顺序即优先级，先命中先归类**，都不中归入「其他」。
  原始 535 个颜文字分类（日文罗马音，如 `yorokobu` / `kani` / `taberu`）经此收敛为 21 个大类，
  41596 条里只有 97 条落在「其他」，占 0.2%。
- `split.mjs` —— 拆分脚本，见文件头注释。

## ⚠️ 源文件已移除

`data/kaomoji.json` 与 `data/emojihub-all.json` 已于 **4.10.2** 从仓库删除：

- 线上已不再使用（代码里零引用）
- 但仍然**公开可下载**（1.64 MB），且会让仓库持续变大

**现在分片文件本身就是权威数据。** 要重跑拆分脚本，先从 git 历史里取回源文件：

```bash
git show 4.10.1:data/kaomoji.json      > data/kaomoji.json
git show 4.10.1:data/emojihub-all.json > data/emojihub-all.json
node tools/emoji-split/split.mjs
```

> 注意：拆分是有损的 —— 合并后的文件中保留的是**条目本身**，
> 原始 535 个细分分类名（与条目的对应关系）只在上述历史源文件里。

## 输出

```
data/emoji-index.json        分类清单（3.7 KB）
data/emoji/<英文名>.json      8 个
data/kaomoji/<英文名>.json    21 个
```

索引条目结构：

```json
{
  "id": "kaomoji:action",
  "label": "动作 / 手势",
  "kind": "kaomoji",
  "file": "/data/kaomoji/action.json",
  "icon": "(_・ω",
  "count": 6318
}
```

前端消费这个索引的代码在 `js/app.js` 的
`loadEmojiIndex()` / `loadEmojiCategory()` / `switchCategory()` / `renderTabs()`。
