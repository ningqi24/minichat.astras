-- ============================================================================
-- MiniChat · 全局限流（Edge Function 用）
-- ============================================================================
--
-- 怎么用：Supabase 后台 → SQL Editor → 新建查询 → 整段粘贴 → Run。
--         可以重复执行，不会报错（都是 create ... if not exists / create or replace）。
--
-- 为什么要它：Edge Function 是无状态多实例的。原先限流计数放在实例内存里，
--       多实例部署时实际配额会被放大若干倍，等于没限住。这份 SQL 把计数落到
--       Postgres，用一条 UPSERT 同时完成「窗口过期则重置」与「未过期则自增」，
--       保证跨实例的原子性。
--
-- 不跑会怎样：Edge Function 里的全局限流会调用失败，但它是 fail-open 的
--       （失败时放行并打日志），所以【不跑也不会坏】，只是退回原来的实例内存限流。
--
-- 配合的代码：supabase/functions/clever-task/index.ts 的 rateLimitGlobal() / rateLimitAll()。
-- 键的命名约定：
--   login:<ip>            登录，20 次/分钟
--   sendcode:email:<邮箱>  发验证码，3 次/10 分钟
--   sendcode:ip:<ip>       发验证码，10 次/10 分钟
--   code:email:<邮箱>      校验验证码，5 次/10 分钟（6 位码防在线爆破）
--   code:ip:<ip>           校验验证码，20 次/10 分钟
-- ============================================================================

create table if not exists public.rate_limit (
  key      text        primary key,
  count    integer     not null default 0,
  reset_at timestamptz not null
);

comment on table public.rate_limit is 'Edge Function 全局限流计数；key 形如 sendcode:email:xxx';

-- 只给 service_role 用：开启 RLS 且不建任何策略 = anon / authenticated 一律不可读写。
alter table public.rate_limit enable row level security;

-- 原子计数：窗口过期则重置为 1，未过期则自增；返回 true 表示未超限。
create or replace function public.rate_limit_hit(
  p_key       text,
  p_max       integer,
  p_window_ms bigint
) returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  now_ts timestamptz := clock_timestamp();
  rec    public.rate_limit%rowtype;
begin
  insert into public.rate_limit as rl (key, count, reset_at)
  values (p_key, 1, now_ts + make_interval(secs => p_window_ms::double precision / 1000.0))
  on conflict (key) do update
    set count    = case when rl.reset_at <= now_ts then 1 else rl.count + 1 end,
        reset_at = case when rl.reset_at <= now_ts
                        then now_ts + make_interval(secs => p_window_ms::double precision / 1000.0)
                        else rl.reset_at end
  returning * into rec;

  return rec.count <= p_max;
end;
$fn$;

-- 清掉过期很久的行，避免表无限增长。可挂 pg_cron 定时跑，也可以手工执行。
create or replace function public.rate_limit_gc()
returns integer
language sql
security definer
set search_path = public
as $fn$
  with gone as (
    delete from public.rate_limit where reset_at <= now() - interval '1 hour'
    returning 1
  )
  select count(*)::integer from gone;
$fn$;

-- 权限：只给 service_role。
revoke all on function public.rate_limit_hit(text, integer, bigint) from public, anon, authenticated;

revoke all on function public.rate_limit_gc() from public, anon, authenticated;

grant execute on function public.rate_limit_hit(text, integer, bigint) to service_role;

grant execute on function public.rate_limit_gc() to service_role;

-- 可选：每天凌晨 4 点自动清理一次（需要 pg_cron 扩展，没装就别跑这两行）。
-- select cron.schedule('rate-limit-gc', '0 4 * * *', $cron$select public.rate_limit_gc();$cron$);
