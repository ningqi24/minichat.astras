# MiniChat · 轻量级实时聊天应用

[![部署状态](https://img.shields.io/badge/demo-online-brightgreen)](https://minichat.astras.cc)  
[![Supabase](https://img.shields.io/badge/后端-Supabase-3b82f6)](https://supabase.com)  
[![许可证](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> 一个极简、现代、支持实时通信的聊天室，单 HTML 文件，开箱即用。

---

## 特性 | Features

- **实时消息**：基于 Supabase Realtime，消息即时推送，无需刷新。  
  **Real-time messaging** – Powered by Supabase Realtime, messages are pushed instantly without page refresh.

- **用户认证**：邮箱注册/登录，支持密码显示切换。  
  **User authentication** – Email sign-up / sign-in with password visibility toggle.

- **个性昵称**：每个用户可设置显示昵称，**修改后自动同步所有历史消息**，告别显示混乱。  
  **Custom display name** – Each user can set a nickname, and **all historical messages are automatically updated** after change, eliminating display inconsistency.

- **消息撤回**：2 分钟内发送的消息可撤回，撤回后所有客户端同步更新。  
  **Message recall** – Messages sent within 2 minutes can be recalled; all clients sync the update instantly.

- **图片分享**：支持点击附件按钮上传图片，自动压缩（>200KB 压缩至 70% 质量），并生成预览。  
  **Image sharing** – Upload images via the attachment button with automatic compression, preview generation.

- **图片预览缩放**：点击图片打开预览，支持鼠标滚轮缩放（100%-500%）、双击切换缩放、拖拽平移。  
  **Image preview zoom** – Click images to open preview, supports mouse wheel zoom, double-click to toggle, drag to pan.

- **双主题**：深色/浅色模式，跟随系统或手动切换，偏好保存在本地。  
  **Dual themes** – Dark/light mode, follows system preference or manual toggle, saved locally.

- **历史记录**：分页加载历史消息（每次 20 条），滚动到顶部自动加载更多。  
  **Message history** – Paginated loading (20 messages per page), auto-loads more when scrolling to top.

- **通知管理**：可在设置中开关桌面通知、通知声音、@提醒，偏好保存在本地。  
  **Notification management** – Toggle desktop notifications, notification sounds, and @mention alerts in settings.

- **侧边栏折叠**：点击底部折叠按钮可收起侧边栏至图标模式，保留 Logo 和操作按钮，折叠状态保存在本地。  
  **Sidebar collapse** – Click the collapse button to shrink the sidebar to icon-only mode, state saved locally.

- **快捷键支持**：按 `Esc` 键可关闭所有弹窗/模态框（输入框聚焦时除外）。  
  **Keyboard shortcuts** – Press `Esc` to close all popups/modals (except when input fields are focused).

- **在线用户显示**：实时显示在线用户列表。  
  **Online user display** – Real-time online user list.

- **PWA 支持**：可安装为桌面/移动应用，支持离线缓存。  
  **PWA support** – Installable as desktop/mobile app with offline caching.

---

## 技术栈 | Tech Stack

- **前端**：原生 HTML + CSS + JavaScript（无框架依赖）  
  **Frontend** – Vanilla HTML + CSS + JavaScript (no framework dependencies)

- **后端 & 数据库**：[Supabase](https://supabase.com)（PostgreSQL + 实时 API + 存储）  
  **Backend & Database** – [Supabase](https://supabase.com) (PostgreSQL + Realtime API + Storage)

- **认证**：Supabase Auth（邮箱/密码）  
  **Authentication** – Supabase Auth (email/password)

- **存储**：Supabase Storage（用于图片上传）  
  **Storage** – Supabase Storage (for image uploads)

- **部署**：静态托管（Vercel / Netlify / Cloudflare Pages 等）  
  **Deployment** – Static hosting (Vercel / Netlify / Cloudflare Pages, etc.)

---

## 🚀 快速开始 | Quick Start

### 1. 部署 Supabase 后端 | Deploy Supabase Backend

1. 在 [Supabase](https://supabase.com) 创建一个新项目。  
   Create a new project on [Supabase](https://supabase.com).

2. 执行以下 SQL 创建表结构（在 Supabase SQL Editor 中运行）：  
   Run the following SQL to create tables (execute in Supabase SQL Editor):

```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT UNIQUE,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  sender_name TEXT,
  sender_email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE messages REPLICA IDENTITY FULL;
ALTER TABLE profiles REPLICA IDENTITY FULL;
```

3. 在 Supabase Storage 中创建一个名为 `chat-images` 的 bucket，并设置为公开（Public），用于存放聊天图片。  
   Create a public bucket named `chat-images` in Supabase Storage for chat images.

4. 在 Authentication → Providers 中启用 Email 登录（默认已启用）。  
   Enable Email login under Authentication → Providers (enabled by default).

### 2. 获取 Supabase 配置 | Get Supabase Configuration

在项目设置中找到：  
Find the following in your project settings:

- **Project URL**（`SUPABASE_URL`）
- **anon public key**（`SUPABASE_ANON_KEY`）

### 3. 部署前端 | Deploy Frontend

**方式一：直接部署（推荐）**  
**Option 1: Direct deployment (recommended)**

- Fork 本仓库，修改 `index.html` 中的 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY` 为你的值。  
  Fork this repo, replace `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `index.html` with your own.
- 将整个项目部署到静态托管平台（Vercel/Netlify 等）。  
  Deploy the entire project to a static hosting platform (Vercel/Netlify, etc.).

**方式二：使用环境变量（更安全）**  
**Option 2: Use environment variables (more secure)**

将 Supabase 配置改为从环境变量读取：  
Replace hardcoded values with environment variables:

```javascript
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
```

并配置平台的环境变量。  
Then configure the environment variables on your platform.

**方式三：本地运行**  
**Option 3: Run locally**

直接打开 `index.html` 即可（但需要修改 Supabase 配置），或使用任何静态服务器（如 `npx serve .`）。  
Simply open `index.html` (but you must modify Supabase config) or use any static server (e.g., `npx serve .`).

---

## 📦 项目结构 | Project Structure

```
minichat.astras/
├── index.html          # 主应用（HTML + CSS + JS）| Main application
├── agreements.html     # 服务协议页面 | Service agreement page
├── manifest.json       # PWA 配置 | PWA manifest
├── sw.js               # Service Worker（离线缓存）| Service Worker
├── CNAME               # DNS 配置 | DNS configuration
├── LICENSE
├── README.md
├── assets/             # 图标资源 | Icon assets
│   ├── logo.svg        # 主 Logo
│   ├── logout.svg      # 登出图标
│   ├── Inspired.svg    # 灵感标识
│   └── basied.svg      # 基础标识
├── data/               # 数据文件 | Data files
│   ├── vision.json     # Vision 数据
│   ├── kaomoji.json    # 颜文字数据
│   └── emojihub-all.json # Emoji 数据
├── lib/                # 第三方库 | Third-party libraries
│   └── supabase.min.js # Supabase SDK
└── past/               # 历史版本 | Historical versions
    ├── MiniChat_v3.0.5_PrivateChat_Beta.html
    ├── MiniChat_v2.4.8_Stable.html
    └── MiniChat_Make.com_Past.html
```

---

## 🔧 配置说明 | Configuration

| 配置项 | 说明 | Description |
|--------|------|-------------|
| `SUPABASE_URL` | Supabase 项目 URL | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase 匿名密钥（公开） | Supabase anon public key |
| `PAGE_SIZE` | 历史消息每页加载数量（默认 20） | Number of historical messages per page (default 20) |
| `SPLASH_DURATION` | 启动页展示时间（毫秒，默认 2600） | Splash screen duration (ms, default 2600) |

---

## 📄 主要功能实现 | Key Feature Implementation

### 昵称与历史消息同步 | Nickname & Historical Message Sync
- 用户修改昵称时，会同时更新 `profiles` 表并 **批量更新** 该用户所有历史消息的 `sender_name` 字段，确保所有旧消息显示新昵称。  
  When a user changes their nickname, the `profiles` table is updated and **all historical messages** from that user have their `sender_name` **bulk-updated**.
- 新消息发送时自动携带当前昵称，保证一致性。  
  New messages automatically carry the current nickname, ensuring consistency.

### 消息撤回 | Message Recall
- 仅允许发送者本人在 2 分钟内撤回。  
  Only the sender can recall their own messages within 2 minutes.
- 撤回后，所有在线客户端通过 Realtime 订阅接收到 `UPDATE` 事件，自动将消息内容改为"（已撤回）"，并移除撤回按钮。  
  After recall, all online clients receive an `UPDATE` event via Realtime subscription.

### 图片上传与压缩 | Image Upload & Compression
- 支持点击附件按钮选择图片，自动压缩（长边限制 1080px，质量 70%），上传至 Supabase Storage。  
  Supports selecting images via the attachment button, with automatic compression, then upload to Supabase Storage.
- 上传成功后插入带有 Markdown 图片语法 `![image](url)` 的消息，前端渲染为可点击预览的图片。  
  On successful upload, inserts a message with Markdown image syntax, rendered as a clickable preview.

### 实时通知 | Real-time Notifications
- 页面不可见时，新消息增加未读计数并修改标题。  
  When the page is not visible, new messages increment the unread counter and modify the page title.
- 若用户授予通知权限，会弹出桌面通知。  
  If the user has granted notification permission, a desktop notification pops up.

### PWA 离线支持 | PWA Offline Support
- 通过 Service Worker 缓存核心资源，支持离线访问。  
  Core resources are cached via Service Worker for offline access.
- 网络恢复后自动同步消息。  
  Messages sync automatically when network is restored.

---

## 🤝 贡献 | Contributing

欢迎提交 Issue 和 Pull Request！  
Issues and Pull Requests are welcome!

1. Fork 本仓库 | Fork this repo
2. 创建你的特性分支 (`git checkout -b feature/amazing-feature`)  
   Create your feature branch (`git checkout -b feature/amazing-feature`)
3. 提交改动 (`git commit -m 'Add some amazing feature'`)  
   Commit your changes (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)  
   Push to the branch (`git push origin feature/amazing-feature`)
5. 打开一个 Pull Request | Open a Pull Request

---

## 📝 许可证 | License

本项目采用 MIT 许可证。详情见 [LICENSE](LICENSE) 文件。  
This project is licensed under the MIT License – see the [LICENSE](LICENSE) file for details.

---

## 🌐 在线演示 | Live Demo

[https://minichat.astras.cc](https://minichat.astras.cc)

---

## 🙏 致谢 | Acknowledgements

- [Supabase](https://supabase.com) - 强大的 BaaS 平台 | Powerful BaaS platform
- [Lucide](https://lucide.dev) - 图标库（内联 SVG）| Icon library (inline SVG)

---

**由 [@ningqi24](https://github.com/ningqi24) 维护**  
**Maintained by [@ningqi24](https://github.com/ningqi24)**