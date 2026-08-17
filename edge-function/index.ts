// Edge Function: clever-task
// 部署到 MiniChat 的 Supabase 项目
// 用法: supabase functions deploy clever-task

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHARED_SECRET = Deno.env.get("FLOXCHAT_BRIDGE_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const supabaseAnon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

    if (action === "get_messages") return await getMessages(body);
    if (action === "send_message") return await sendMessage(body);
    if (action === "get_users") return await getUsers(body);
    return await login(body);
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});

// ---- 登录（已存在用户直接登录，新用户自动注册） ----
async function login(body: any) {
  const { email, password, display_name } = body;

  const { data: signInData, error: signInError } =
    await supabaseAnon.auth.signInWithPassword({ email, password });

  if (signInData?.session) {
    await ensureProfileAndConversation(signInData.user!.id, email, display_name);
    return json({
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
      user_id: signInData.user!.id,
      email,
      display_name: display_name || email.split("@")[0],
    });
  }

  if (signInError && signInError.message !== "Invalid login credentials") {
    throw new Error(`登录检查失败: ${signInError.message}`);
  }

  const { data: newUser, error: createError } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { source: "floxchat", display_name },
    });

  if (createError && createError.message.includes("already been registered")) {
    const { data: users } = await supabaseAdmin.auth.admin.listUsers();
    const existing = users?.users?.find((u: any) => u.email === email);
    if (!existing) throw new Error("用户查询失败");

    await supabaseAdmin.auth.admin.updateUserById(existing.id, { password });
    await ensureProfileAndConversation(existing.id, email, display_name);

    const { data: relogin } = await supabaseAnon.auth.signInWithPassword({ email, password });
    if (!relogin?.session) throw new Error("重置密码后登录失败");

    return json({
      access_token: relogin.session.access_token,
      refresh_token: relogin.session.refresh_token,
      user_id: relogin.user!.id,
      email,
      display_name: display_name || email.split("@")[0],
    });
  }

  if (createError) throw new Error(`创建用户失败: ${createError.message}`);

  if (newUser.user) {
    await ensureProfileAndConversation(newUser.user.id, email, display_name);
  }

  const { data: finalSignIn } = await supabaseAnon.auth.signInWithPassword({
    email,
    password,
  });

  if (!finalSignIn?.session) throw new Error("新用户登录失败");

  return json({
    access_token: finalSignIn.session.access_token,
    refresh_token: finalSignIn.session.refresh_token,
    user_id: finalSignIn.user!.id,
    email,
    display_name: display_name || email.split("@")[0],
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
