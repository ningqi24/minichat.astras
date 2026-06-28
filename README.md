A simple “minichat” project 

- **Inspired by “SimpleChat（https://space.bilibili.com/1447858895）“**
- **Basied on ”Chatmini“ ”Astras.cc“ ”Supabase.com“ ”Spacemail.com“**
- **By https://github.com/ningqi24**

# MiniChat · 轻量级实时聊天应用

[![部署状态](https://img.shields.io/badge/demo-online-brightgreen)](https://minichat.astras.cc)
[![Supabase](https://img.shields.io/badge/后端-Supabase-3b82f6)](https://supabase.com)
[![许可证](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> ![MiniChat](./assets/logo.svg)  一个极简、现代、支持实时通信的聊天室，单 HTML 文件，开箱即用。

![Inspired](./assets/Inspired.svg) ![basied](./assets/basied.svg) 

---

## 特性

- **实时消息**：基于 Supabase Realtime，消息即时推送，无需刷新。
- **用户认证**：邮箱注册/登录，支持密码显示切换。
- **个性昵称**：每个用户可设置显示昵称，**修改后自动同步所有历史消息**（方案A），告别显示混乱。
- **消息撤回**：2 分钟内发送的消息可撤回，撤回后所有客户端同步更新。
- **图片分享**：支持点击附件按钮上传图片，自动压缩（>200KB 压缩至 70% 质量），并生成预览，点击图片可放大/下载。
- **双主题**：深色/浅色模式，跟随系统或手动切换，偏好保存在本地。
- **历史记录**：分页加载历史消息（每次 20 条），滚动到顶部自动加载更多。
- **新消息通知**：页面后台时自动增加未读计数，并支持浏览器桌面通知（需授权）。
- **移动端适配**：响应式设计，在手机和桌面上均有良好体验。
- **在线用户显示** / **PWA支持** / 更多内容等你来探寻，提交你的PUSH！

---

## 技术栈

- **前端**：原生 HTML + CSS + JavaScript（无框架依赖）
- **后端 & 数据库**：[Supabase](https://supabase.com)（PostgreSQL + 实时 API + 存储）
- **认证**：Supabase Auth（邮箱/密码）
- **存储**：Supabase Storage（用于图片上传）
- **部署**：静态托管（Vercel / Netlify / Cloudflare Pages 等）

---

## 🚀 快速开始

### 1. 部署 Supabase 后端

1. 在 [Supabase](https://supabase.com) 创建一个新项目。
2. 执行以下 SQL 创建表结构（在 Supabase SQL Editor 中运行）：

```sql
-- 用户资料表
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT UNIQUE,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 消息表
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  sender_name TEXT,
  sender_email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 启用实时（Realtime）
ALTER TABLE messages REPLICA IDENTITY FULL;
ALTER TABLE profiles REPLICA IDENTITY FULL;
```

3. 在 Supabase Storage 中创建一个名为 `chat-images` 的 bucket，并设置为公开（Public），用于存放聊天图片。
4. 在 Authentication → Providers 中启用 Email 登录（默认已启用）。

### 2. 获取 Supabase 配置

在项目设置中找到：
- **Project URL**（`SUPABASE_URL`）
- **anon public key**（`SUPABASE_ANON_KEY`）

### 3. 部署前端

**方式一：直接部署（推荐）**

- Fork 本仓库，修改 `index.html` 中的 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY` 为你的值（或使用环境变量）。
- 将整个项目部署到静态托管平台（Vercel/Netlify 等）。

**方式二：使用环境变量（更安全）**

将 Supabase 配置改为从环境变量读取（例如 Vercel 的环境变量）：

```javascript
// 在 index.html 中替换硬编码为：
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
```

并配置平台的环境变量。

**方式三：本地运行**

直接打开 `index.html` 即可（但需要修改 Supabase 配置），或使用任何静态服务器（如 `npx serve .`）。

---

## 📦 项目结构

```
minichat.astras/
├── index.html          # 完整应用（HTML + CSS + JS）
├── assets/             # 图标资源（logo.svg, Inspired.svg, basied.svg）
├── README.md
└── LICENSE
```

---

## 🔧 配置说明

| 配置项 | 说明 |
|--------|------|
| `SUPABASE_URL` | Supabase 项目 URL |
| `SUPABASE_ANON_KEY` | Supabase 匿名密钥（公开） |
| `PAGE_SIZE` | 历史消息每页加载数量（默认 20） |
| `SPLASH_DURATION` | 启动页展示时间（毫秒，默认 2600） |

---

## 📄 主要功能实现

### 昵称与历史消息同步
- 用户修改昵称时，会同时更新 `profiles` 表并 **批量更新** 该用户所有历史消息的 `sender_name` 字段，确保所有旧消息显示新昵称。
- 新消息发送时自动携带当前昵称，保证一致性。

### 消息撤回
- 仅允许发送者本人在 2 分钟内撤回。
- 撤回后，所有在线客户端通过 Realtime 订阅接收到 `UPDATE` 事件，自动将消息内容改为“（已撤回）”，并移除撤回按钮。

### 图片上传与压缩
- 支持点击附件按钮选择图片，自动压缩（长边限制 1080px，质量 70%），上传至 Supabase Storage。
- 上传成功后插入带有 Markdown 图片语法 `![image](url)` 的消息，前端渲染为可点击预览的图片。

### 实时通知
- 页面不可见时，新消息增加未读计数并修改标题。
- 若用户授予通知权限，会弹出桌面通知。

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建你的特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交改动 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开一个 Pull Request

---

## 📝 许可证

本项目采用 MIT 许可证。详情见 [LICENSE](LICENSE) 文件。

---

## 🌐 在线演示

[https://minichat.astras.cc](https://minichat.astras.cc)

---

## 🙏 致谢

- [Supabase](https://supabase.com) - 强大的 BaaS 平台
- [Lucide](https://lucide.dev) - 图标库（内联 SVG）

---

**由 [@ningqi24](https://github.com/ningqi24) 维护**
