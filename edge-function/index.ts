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
//   3. flox_code_login 对验证码做了严格校验与限流。
//   4. 本函数不读取 FloxChat 用户表，也绝不在 FloxChat 侧创建/修改/删除任何账号。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHARED_SECRET = Deno.env.get("FLOXCHAT_BRIDGE_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// ---- FloxChat 验证码校验地址（服务端专用）----
const FLOXCHAT_VERIFY_URL = Deno.env.get("FLOXCHAT_VERIFY_URL") ?? "https://shebiao.dpdns.org/ces/verify-code";
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

    if (action === "flox_code_login") return await floxCodeLogin(req, body);
    if (action === "get_messages") return await getMessages(body);
    if (action === "send_message") return await sendMessage(body);
    if (action === "get_users") return await getUsers(body);
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

// 验证码登录（兼容旧流程）：验证码在服务端向 FloxChat 校验，客户端不再自行判定
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

