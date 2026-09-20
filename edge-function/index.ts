// Edge Function: clever-task
// 部署到 MiniChat 的 Supabase 项目
// 用法: supabase functions deploy clever-task
//
// 环境变量：
//   FLOXCHAT_BRIDGE_SECRET  必填，前端/扩展的桥接密钥（沿用现有）
//   MINICHAT_BRIDGE_PEPPER  建议设置：独立随机串，用于派生 MiniChat 账号口令，勿与其它密钥复用
//   FLOXCHAT_VERIFY_URL     可选，FloxChat 验证码校验地址（默认 https://shebiao.dpdns.org/ces/verify-code）
//
// 动作（全部需要请求体里的 secret）：
//   flox_code_login  { email, code }              服务端校验 FloxChat 验证码后签发 MiniChat 会话
//   get_messages     { access_token, limit, ... } 读历史消息（身份由 token 推导）
//   send_message     { access_token, content, ...} 发消息（身份由 token 推导，不可伪造）
//   get_users        { access_token }             读用户列表（供 TurboWarp 扩展使用）
//   login            { email }                   兼容旧扩展：口令由服务端密钥派生，忽略客户端 password；
//                                                仅对已存在账号签发会话，不自动建号（防绕过 CAPTCHA 注册）
//
// 安全约束：
//   1. 绝不调用 updateUserById({ password }) 去覆盖既有账号的口令。
//   2. login 不接受客户端指定的口令，账号已存在且派生口令不匹配时直接返回 401。
//   3. flox_code_login 对验证码做了严格校验与限流；账号只在验证码校验通过后才开通。
//   4. flox_send_code 只是把「发送验证码」这一请求代理到 FloxChat，方便 TurboWarp 扩展
//      调用（扩展直接 fetch 会被 CORS 拦截）。
//   5. 本函数不读取 FloxChat 用户表，也绝不在 FloxChat 侧创建/修改/删除任何账号。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHARED_SECRET = Deno.env.get("FLOXCHAT_BRIDGE_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// ---- FloxChat 验证码校验地址（服务端专用）----
const FLOXCHAT_VERIFY_URL = Deno.env.get("FLOXCHAT_VERIFY_URL") ?? "https://shebiao.dpdns.org/ces/verify-code";
// ---- FloxChat 发送验证码地址（服务端代理，扩展端不直接请求，避免 CORS）----
const FLOXCHAT_SEND_URL = Deno.env.get("FLOXCHAT_SEND_URL") ?? "https://shebiao.dpdns.org/ces/send-code";
// MiniChat 侧账号口令由服务端密钥派生，客户端无法推算（部署时请设置独立随机值）
const MINICHAT_BRIDGE_PEPPER = Deno.env.get("MINICHAT_BRIDGE_PEPPER") ?? SHARED_SECRET;
if (!Deno.env.get("MINICHAT_BRIDGE_PEPPER")) {
  console.warn(
    "[clever-task] 警告：MINICHAT_BRIDGE_PEPPER 未设置，正回退到公开的桥接密钥，" +
      "派生口令可被任何人推算，请立即在 Supabase 设置独立随机串。",
  );
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const supabaseAnon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 专门用来做 signInWithPassword 的客户端。
// 原因：GoTrue 在开启 CAPTCHA 后会给 /token?grant_type=password 强制校验 captcha_token
// （见 supabase/auth internal/api/api.go 的 r.With(api.verifyCaptcha).Post("/token", ...)），
// 但它同时有一条例外（internal/api/middleware.go）：
//     if _, err := a.requireAdminCredentials(w, req); err == nil { return ctx, nil }
// 也就是 Authorization 头里带 service_role 时跳过 CAPTCHA。
// 所以服务端用 service_role 登录，客户端侧才需要真的过验证码。
// 单独建一个客户端是为了避免 supabaseAdmin 被 signInWithPassword 挂上用户会话，
// 那样后续 .from() 查询就会以用户身份（受 RLS 限制）而不是 service_role 执行。
const supabaseAdminAuth = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

// ---- 轻量限流（best-effort：按 Edge 实例内存计数，多实例部署时不是全局配额）----
const RATE_BUCKETS = new Map<string, number[]>();
function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (RATE_BUCKETS.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    RATE_BUCKETS.set(key, hits);
    return false;
  }
  hits.push(now);
  RATE_BUCKETS.set(key, hits);
  if (RATE_BUCKETS.size > 5000) {
    for (const [k, v] of RATE_BUCKETS) {
      if (!v.some((t) => now - t < windowMs)) RATE_BUCKETS.delete(k);
    }
  }
  return true;
}
function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "unknown";
}
function sessionPayload(session: any, email: string, displayName: string) {
  return json({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    user_id: session.user!.id,
    email,
    display_name: displayName,
  });
}

// ---- 从 body 中的 access_token 校验并取回用户（token 放 body，不走 Authorization 头，绕开 Electron CORS bug）----
async function getUserFromBody(body: any) {
  const token = body?.access_token;
  if (!token || typeof token !== "string") return null;
  const { data, error } = await supabaseAnon.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, apikey, authorization",
      },
    });
  }

  try {
    const body = await req.json();
    const { action, secret } = body;

    // 统一密钥校验（verify_jwt 已关闭，靠 secret 保护）
    if (secret !== SHARED_SECRET) {
      return json({ error: "unauthorized" }, 403);
    }

    if (action === "flox_send_code") return await floxSendCode(req, body);
    if (action === "flox_code_login") return await floxCodeLogin(req, body);
    if (action === "get_messages") return await getMessages(body);
    if (action === "send_message") return await sendMessage(body);
    if (action === "get_users") return await getUsers(body);
    if (action === "upload_file") return await uploadFile(body);
    if (action === "storage_gc") return json(await storageGc(Boolean(body?.force)));
    return await login(req, body);
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});

// ---- 兼容旧扩展的登录：口令由服务端派生；只给已存在的账号签发会话，不再自动建号 ----
async function login(req: Request, body: any) {
  const email = String(body?.email ?? "").trim().toLowerCase();
  const display_name =
    String(body?.display_name ?? "").trim().slice(0, 64) || email.split("@")[0];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "invalid_email", code: "INVALID_EMAIL" }, 400);
  }
  if (!rateLimit(`login:${clientIp(req)}`, 20, 60_000)) {
    return json({ error: "too_many_requests", code: "RATE_LIMITED" }, 429);
  }
  // 客户端传来的 password 一律忽略：口令只由服务端密钥派生
  const password = await bridgePassword(email);

  const { data: signInData } =
    await supabaseAdminAuth.auth.signInWithPassword({ email, password });

  if (signInData?.session) {
    await ensureProfileAndConversation(signInData.user!.id, email, display_name);
    return sessionPayload(signInData.session, email, display_name);
  }

  // 登录失败：账号不存在，或者口令不是服务端派生值。
  //
  // ⚠️ 这里刻意【不再】调用 admin.createUser 自动建号：
  //    桥接密钥是公开的（写在前端/扩展里），自动建号等于留了一个绕过网站
  //    Turnstile 的注册后门——任何人 POST {action:"login", email:"任意邮箱"} 就能
  //    拿到一个 email_confirm=true 的账号，进而读取全站消息和用户资料。
  //    注册必须回到带 CAPTCHA 的网站入口。
  //    扩展用户的路径：先到网站用 FloxChat 验证码登录一次（账号会以服务端
  //    派生口令开通），之后本扩展即可正常连接。
  const { data: existingProfile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingProfile) {
    return json({
      error: "该邮箱已有 MiniChat 账号，但口令与桥接不匹配。请先到网站用 FloxChat 验证码登录一次。",
      code: "ACCOUNT_EXISTS",
    }, 401);
  }

  return json({
    error: "账号不存在。请先到网站用 FloxChat 验证码登录一次，扩展即可正常连接。",
    code: "ACCOUNT_NOT_FOUND",
  }, 404);
}

// ============================================================================
// FloxChat 账号校验（服务端代理）
// 约束：只负责“邮箱验证码 → MiniChat 会话”的换发，不读取 FloxChat 用户表、
//       不提供密码登录，也绝不在 FloxChat 侧创建/修改/删除任何账号。
// ============================================================================

// 发送 FloxChat 验证码（服务端代理）。
// 扩展在 TurboWarp/Electron 里直接 fetch shebiao.dpdns.org 会被 CORS 拦住，
// 所以绕一层服务端。同时做限流，避免被人拿来给别人的邮箱刷验证码。
async function floxSendCode(req: Request, body: any) {
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "invalid_email", code: "INVALID_EMAIL" }, 400);
  }
  if (
    !rateLimit(`sendcode:email:${email}`, 3, 10 * 60_000) ||
    !rateLimit(`sendcode:ip:${clientIp(req)}`, 10, 10 * 60_000)
  ) {
    return json({ error: "发送过于频繁，请稍后再试", code: "RATE_LIMITED" }, 429);
  }

  try {
    const resp = await fetch(FLOXCHAT_SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const text = await resp.text();
    if (!resp.ok) {
      return json({
        error: `FloxChat 发送验证码失败（HTTP ${resp.status}）`,
        code: "FLOX_SEND_FAILED",
      }, 502);
    }
    return json({ ok: true });
  } catch (e: any) {
    return json({ error: `FloxChat 发送服务暂不可用: ${e.message}`, code: "FLOX_UNAVAILABLE" }, 502);
  }
}

// 验证码登录（兼容旧流程）：验证码在服务端向 FloxChat 校验，客户端不再自行判定
// 校验通过后由 issueSession 开通 MiniChat 账号（首次）或直接签发会话（已有）
async function floxCodeLogin(req: Request, body: any) {
  const email = String(body?.email ?? "").trim().toLowerCase();
  const code = String(body?.code ?? "").trim();
  if (!email || !code) {
    return json({ error: "missing_credentials", code: "MISSING_CREDENTIALS" }, 400);
  }
  if (!/^[A-Za-z0-9]{4,12}$/.test(code)) {
    return json({ error: "invalid_code", code: "INVALID_CODE" }, 401);
  }
  // 限流：验证码只有 6 位，不限流可被离线爆破
  if (
    !rateLimit(`code:email:${email}`, 5, 10 * 60_000) ||
    !rateLimit(`code:ip:${clientIp(req)}`, 20, 10 * 60_000)
  ) {
    return json({ error: "尝试过于频繁，请稍后再试", code: "RATE_LIMITED" }, 429);
  }

  let text = "";
  try {
    const resp = await fetch(FLOXCHAT_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    text = await resp.text();
  } catch (e: any) {
    return json({ error: `FloxChat 校验服务暂不可用: ${e.message}`, code: "FLOX_UNAVAILABLE" }, 502);
  }

  let ok = false;
  try {
    const parsed = JSON.parse(text);
    ok = parsed?.success === true || parsed?.verified === true;
  } catch (_) {
    // 非 JSON 响应时只接受「整段就是 true/verified/ok/success」这种纯文本，
    // 不再做子串匹配——旧实现只要响应里出现 verified 这个词就放行，
    // 一段含有 "not verified" 的报错页也会被当成校验通过。
    ok = /^\s*"?(true|verified|ok|success)"?\s*$/i.test(text);
  }
  if (!ok) return json({ error: "invalid_code", code: "INVALID_CODE" }, 401);

  return await issueSession(email, email.split("@")[0], "");
}

// 由服务端密钥推导 MiniChat 账号口令（每次现算，不落库、不下发）
async function bridgePassword(email: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(MINICHAT_BRIDGE_PEPPER),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode("minichat:" + email.toLowerCase())));
  return "fp_" + Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 仅处理 MiniChat(Supabase) 侧的账号开通与会话签发，不触碰 FloxChat 数据
async function issueSession(email: string, displayName: string, floxUid: string) {
  const password = await bridgePassword(email);

  let session =
    (await supabaseAdminAuth.auth.signInWithPassword({ email, password })).data?.session ?? null;

  if (!session) {
    const created = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { source: "floxchat", display_name: displayName, flox_uid: floxUid },
    });

    if (created.error && /already been registered|already registered|exists/i.test(created.error.message)) {
      const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers();
      if (listError) throw new Error(`用户查询失败: ${listError.message}`);
      const existing = list?.users?.find(
        (u: any) => String(u.email ?? "").toLowerCase() === email.toLowerCase(),
      );
      if (!existing) throw new Error("用户查询失败");
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(existing.id, { password });
      if (updateError) throw new Error(`更新账号失败: ${updateError.message}`);
    } else if (created.error) {
      throw new Error(`开通 MiniChat 账号失败: ${created.error.message}`);
    }

    session = (await supabaseAdminAuth.auth.signInWithPassword({ email, password })).data?.session ?? null;
  }

  if (!session) throw new Error("建立会话失败");
  await ensureProfileAndConversation(session.user!.id, email, displayName);

  return json({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    user_id: session.user!.id,
    email,
    display_name: displayName,
  });
}

// ---- 读历史消息（service_role，绕过 RLS，按时间新到旧；需登录 token） ----
async function getMessages(body: any) {
  const user = await getUserFromBody(body);
  if (!user) return json({ error: "unauthorized" }, 401);

  const limit = Math.min(parseInt(body.limit) || 30, 1000);
  const offset = parseInt(body.offset) || 0;

  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);
  return json({ messages: data || [] });
}

// ---- 发消息（service_role；需登录 token，发送者身份由 token 推导，防止伪造） ----
async function sendMessage(body: any) {
  const user = await getUserFromBody(body);
  if (!user) return json({ error: "unauthorized" }, 401);

  // 限流：每个账号每分钟最多 20 条，防止脚本刷屏
  if (!rateLimit(`send:${user.id}`, 20, 60_000)) {
    return json({ error: "发送过于频繁，请稍后再试", code: "RATE_LIMITED" }, 429);
  }

  const content = String(body.content || "");
  if (!content.trim()) return json({ error: "empty content" }, 400);

  const sender_email = user.email;
  if (!sender_email) return json({ error: "missing sender_email" }, 400);

  const sender_name = body.sender_name
    ? String(body.sender_name).slice(0, 64)
    : sender_email.split("@")[0];

  const { data, error } = await supabaseAdmin
    .from("messages")
    .insert({
      content,
      sender_email,
      sender_name: sender_name || null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return json({ ok: true, message: data });
}

// ================= 存储容量自动清理 =================
// 免费额度 1GB，留点余量：超过 950MB 就删，删到 900MB 以下。
// 不用新表：靠 Storage 的 list() 现算总量（结果缓存 5 分钟）。
const STORAGE_BUCKETS = ["chat-images", "chat-audios", "chat-videos", "chat-files"];
const STORAGE_SOFT_LIMIT = 950 * 1024 * 1024;   // 超过它开始清理
const STORAGE_TARGET = 900 * 1024 * 1024;       // 清理到这个值以下
let storageUsageCache: { bytes: number; at: number } | null = null;

async function listAllObjects(bucket: string) {
  const out: any[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 40000; offset += PAGE) {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .list("public", { limit: PAGE, offset, sortBy: { column: "created_at", order: "asc" } });
    if (error) break;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

async function collectStorageUsage() {
  let total = 0;
  const items: { bucket: string; name: string; createdAt: string; size: number }[] = [];
  for (const b of STORAGE_BUCKETS) {
    const objs = await listAllObjects(b);
    for (const o of objs) {
      const size = Number(o?.metadata?.size ?? 0);
      if (!o || !o.name) continue;
      total += size;
      items.push({ bucket: b, name: o.name, createdAt: String(o.created_at ?? ""), size });
    }
  }
  // 最老的排前面
  items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return { total, items };
}

// force=false 时会走 5 分钟缓存；force=true 强制重算（给定时任务用）
async function storageGc(force = false) {
  const now = Date.now();
  if (!force && storageUsageCache && now - storageUsageCache.at < 5 * 60_000) {
    return { skipped: true, total: storageUsageCache.bytes, deleted: 0 };
  }
  const { total, items } = await collectStorageUsage();
  storageUsageCache = { bytes: total, at: now };
  if (total <= STORAGE_SOFT_LIMIT) return { total, deleted: 0 };

  let remaining = total;
  let deleted = 0;
  for (const it of items) {
    if (remaining <= STORAGE_TARGET) break;
    const { error } = await supabaseAdmin.storage.from(it.bucket).remove(["public/" + it.name]);
    if (!error) { remaining -= it.size; deleted++; }
  }
  storageUsageCache = { bytes: remaining, at: Date.now() };
  return { total, remaining, deleted };
}

// ---- 上传文件（供 TurboWarp 扩展用）----
// 为什么需要中转：浏览器直传 Storage 时，Supabase 的 CORS 预检在 TurboWarp 桌面版里
// 过不去（同主机、无自定义头的简单请求却可以）。走这个已经验证可用的 Edge 通道最稳。
// 客户端把文件读成 base64（+33%），Edge 用 service_role 写进 Storage，返回公开 URL。
async function uploadFile(body: any) {
  const user = await getUserFromBody(body);
  if (!user) return json({ error: "unauthorized" }, 401);

  const ALLOWED = ["chat-images", "chat-audios", "chat-videos", "chat-files"];
  const bucket = String(body.bucket ?? "");
  const path = String(body.path ?? "");
  const contentType = String(body.content_type ?? "application/octet-stream").slice(0, 120);
  const b64 = String(body.data ?? "");

  if (!ALLOWED.includes(bucket)) return json({ error: "bad_bucket" }, 400);
  // 路径必须以字母数字开头（原来允许 "." 开头，能造出 public/. 这种怪名字）
  if (!/^public\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(path)) return json({ error: "bad_path" }, 400);
  if (!b64) return json({ error: "empty_data" }, 400);

  // base64 -> 近似字节数，先按大小拦掉，避免把超大 payload 解出来
  const approxBytes = Math.floor((b64.length * 3) / 4);
  if (approxBytes > 64 * 1024 * 1024) return json({ error: "文件过大", code: "TOO_LARGE" }, 413);

  // 限流：每分钟 + 每天（内存态，冷启动会重置，属于尽力而为）
  if (!rateLimit(`upload:${user.id}`, 20, 60_000)) {
    return json({ error: "上传过于频繁，请稍后再试", code: "RATE_LIMITED" }, 429);
  }
  if (!rateLimit(`upload_day:${user.id}`, 300, 24 * 60 * 60 * 1000)) {
    return json({ error: "今天上传次数已达上限，请明天再试", code: "RATE_LIMITED" }, 429);
  }

  // 先看一眼容量：快到 1GB 就把最老的文件清掉（5 分钟内只算一次）
  try {
    const gc = await storageGc();
    if ((gc as any).deleted) {
      console.log(`storage gc: 删除 ${(gc as any).deleted} 个文件，剩余 ${(((gc as any).remaining ?? 0) / 1048576).toFixed(0)}MB`);
    }
  } catch (e) {
    console.error("storage gc 失败（不影响上传）:", e);
  }

  // ★ 主动读 bucket 配置，在 Edge 侧强制同一条规则。
  // 为什么必须自己再查一遍：bucket 的 file_size_limit / allowed_mime_types 是
  // Storage API 层面强制的（与 RLS 无关，service_role 也受限）；但如果管理员只用
  // RLS 策略限制，service_role 会直接绕过 RLS —— 所以这里两种配置都自己兜住。
  const { data: bucketInfo } = await supabaseAdmin.storage.getBucket(bucket);
  if (!bucketInfo) return json({ error: "bad_bucket" }, 400);

  // 代码里的兜底上限（和网页端一致），bucket 没设限制时用
  const FALLBACK_LIMIT_MB: Record<string, number> = {
    "chat-images": 5, "chat-audios": 20, "chat-videos": 50, "chat-files": 10,
  };
  const bucketLimit = typeof bucketInfo.file_size_limit === "number" ? bucketInfo.file_size_limit : null;
  const limitBytes = bucketLimit ?? (FALLBACK_LIMIT_MB[bucket] ?? 10) * 1024 * 1024;
  if (approxBytes > limitBytes) {
    return json({
      error: `文件超过限制（${(limitBytes / 1048576).toFixed(0)}MB）`,
      code: "TOO_LARGE",
    }, 413);
  }

  const allowedMimes = Array.isArray(bucketInfo.allowed_mime_types) ? bucketInfo.allowed_mime_types : null;
  if (allowedMimes && allowedMimes.length && !allowedMimes.includes(contentType)) {
    return json({ error: `该 bucket 不接受这种类型：${contentType}`, code: "BAD_MIME" }, 415);
  }

  let bytes: Uint8Array;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return json({ error: "bad_base64" }, 400);
  }

  // 解码后再核对一次真实大小（base64 近似值可能有 ±2 字节误差）
  if (bytes.length > limitBytes) {
    return json({ error: `文件超过限制（${(limitBytes / 1048576).toFixed(0)}MB）`, code: "TOO_LARGE" }, 413);
  }

  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) return json({ error: error.message }, 400);

  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
  return json({ ok: true, url: data.publicUrl });
}

// ---- 读全部用户（在线+离线，来自 profiles 表；需登录 token） ----
async function getUsers(body: any) {
  const user = await getUserFromBody(body);
  if (!user) return json({ error: "unauthorized" }, 401);

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email, display_name, avatar_url, last_login")
    .order("last_login", { ascending: false });

  if (error) throw new Error(error.message);
  return json({ users: data || [] });
}

async function ensureProfileAndConversation(
  uid: string,
  email: string,
  display_name: string,
) {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("id", uid)
    .maybeSingle();

  if (!profile) {
    await supabaseAdmin.from("profiles").insert({
      id: uid,
      email,
      display_name: display_name || email.split("@")[0],
      last_login: new Date().toISOString(),
    });
    await supabaseAdmin.from("conversation_participants").insert({
      conversation_id: "00000000-0000-0000-0000-000000000000",
      user_id: uid,
    });
  } else {
    await supabaseAdmin.from("profiles")
      .update({ last_login: new Date().toISOString() })
      .eq("id", uid);
  }
}

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

