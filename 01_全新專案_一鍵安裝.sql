-- 米粒魔術師 GitHub Pages v2.4：全新專案一鍵安裝
-- 【用途】僅限全新、尚未安裝米粒魔術師資料表的 Supabase 專案。
-- 【安全】若偵測到既有資料表/管理設定，立即中止，不會刪除或覆蓋資料。
-- 【功能】核心測驗／班級及成績／班級管理／記住裝置／預設 RICE401。
-- 【部署】在 Supabase SQL Editor 貼上「整份檔案」並執行一次。
-- 【重要】管理碼和教師成績查閱碼只顯示在最後一個查詢結果，請立即妥善保存。
-- 【重要】正式已上線的資料庫，請使用專用增量升級 SQL，不要使用此檔。
-- 【說明】前端健康檢查 schema_version 仍為 2.1，因 v2.4 延續核心 API 相容版本，屬於預期。

BEGIN;

-- 安裝前防護：不允許對已部署或部分安裝的舊專案直接執行完整安裝。
DO $rice_fresh_install_guard$
BEGIN
  IF to_regclass('public.rice_classes') IS NOT NULL
     OR to_regclass('public.rice_attempts') IS NOT NULL
     OR to_regclass('rice_private.management_settings') IS NOT NULL
     OR to_regclass('rice_private.management_device_tokens') IS NOT NULL
  THEN
    RAISE EXCEPTION '已有米粒魔術師資料表或管理設定；停止全新安裝以保護既有成績。請改用增量升級 SQL。';
  END IF;
END;
$rice_fresh_install_guard$;



-- =====================================================
-- 安裝階段 1：sql/01_schema.sql
-- =====================================================

-- 米粒魔術師 GitHub Pages v2.1.1 SQL 修正版（保留 2.1 API 版本）
-- 執行環境：Supabase SQL Editor；既有測試資料可用 00_reset_and_install.sql 清空重建。
-- 本設計不使用 Supabase Auth，也不向匿名訪客開放資料表 SELECT。
-- 學生透過班級代碼提交；教師以班級專屬查閱碼調用受限 RPC。

create table if not exists public.rice_classes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  class_code text not null unique check (class_code ~ '^[A-Z0-9]{6,12}$'),
  teacher_key text not null unique check (teacher_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.rice_attempts (
  id bigint generated always as identity primary key,
  class_id uuid not null references public.rice_classes(id) on delete restrict,
  seat_number integer not null check (seat_number between 1 and 99),
  answers jsonb not null check (jsonb_typeof(answers) = 'array' and jsonb_array_length(answers) = 12),
  score integer not null check (score between 0 and 12),
  total integer not null default 12 check (total = 12),
  wrong_items integer[] not null default '{}',
  client_run_id uuid not null unique,
  created_at timestamptz not null default now()
);
create index if not exists rice_attempts_class_seat_time_idx
  on public.rice_attempts(class_id,seat_number,created_at,id);

-- 禁止透過 /rest/v1/rice_classes、/rest/v1/rice_attempts 直接讀取、寫入。
alter table public.rice_classes enable row level security;
alter table public.rice_attempts enable row level security;
revoke all on table public.rice_classes,public.rice_attempts from public, anon, authenticated;
revoke all on sequence public.rice_attempts_id_seq from public, anon, authenticated;

create schema if not exists rice_private;
revoke all on schema rice_private from public;
grant usage on schema rice_private to anon;

-- private schema 未加入 Supabase API exposed schemas；其函式只有指定的公開 RPC 包裝器可透過 API 使用。
create or replace function rice_private.lookup_class(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_class public.rice_classes%rowtype;
begin
  select * into v_class from public.rice_classes
    where class_code = upper(btrim(p_code));
  if not found then raise exception '班級代碼錯誤'; end if;
  return pg_catalog.jsonb_build_object('class_name',v_class.name,'class_code',v_class.class_code);
end;
$$;

create or replace function rice_private.submit_attempt(
  p_class_code text,p_seat_number integer,p_answers jsonb,p_client_run_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_class public.rice_classes%rowtype;
  v_old public.rice_attempts%rowtype;
  v_new public.rice_attempts%rowtype;
  v_keys text[] := array['yes','no','yes','no','yes','no','yes','no','yes','no','yes','no'];
  v_wrong integer[] := array[]::integer[];
  v_score integer := 0;
  i integer;
  v_count integer;
begin
  if p_seat_number is null or p_seat_number not between 1 and 99 then
    raise exception '座號必須為 1 至 99';
  end if;
  if p_client_run_id is null then raise exception '缺少測驗識別碼'; end if;
  if p_answers is null or pg_catalog.jsonb_typeof(p_answers) <> 'array'
    or pg_catalog.jsonb_array_length(p_answers) <> 12 then
    raise exception '作答必須包含 12 題';
  end if;
  select * into v_class from public.rice_classes
    where class_code=upper(btrim(p_class_code));
  if not found then raise exception '班級代碼錯誤'; end if;

  -- 同一輪測驗失敗重試時不能重複計分。
  select * into v_old from public.rice_attempts where client_run_id=p_client_run_id;
  if found then
    if v_old.class_id <> v_class.id or v_old.seat_number <> p_seat_number or v_old.answers <> p_answers then
      raise exception '測驗識別碼衝突';
    end if;
    return pg_catalog.jsonb_build_object('id',v_old.id,'score',v_old.score,'total',v_old.total,
      'wrong_items',pg_catalog.to_jsonb(v_old.wrong_items),'submitted_at',v_old.created_at);
  end if;

  for i in 1..12 loop
    if (p_answers ->> (i-1)) not in ('yes','no') or (p_answers ->> (i-1)) is null then
      raise exception '作答內容不正確';
    end if;
    if (p_answers ->> (i-1)) = v_keys[i] then
      v_score := v_score + 1;
    else
      v_wrong := pg_catalog.array_append(v_wrong,i);
    end if;
  end loop;

  select count(*) into v_count from public.rice_attempts
   where class_id=v_class.id and seat_number=p_seat_number and created_at>now()-interval '24 hours';
  if v_count>=30 then raise exception '同一座號的作答過於頻繁（24 小時內至多 30 次）'; end if;

  insert into public.rice_attempts(class_id,seat_number,answers,score,wrong_items,client_run_id)
    values(v_class.id,p_seat_number,p_answers,v_score,v_wrong,p_client_run_id)
    on conflict (client_run_id) do nothing returning * into v_new;
  if v_new.id is null then
    select * into v_new from public.rice_attempts where client_run_id=p_client_run_id;
    if v_new.class_id <> v_class.id or v_new.seat_number <> p_seat_number or v_new.answers <> p_answers then
      raise exception '測驗識別碼衝突';
    end if;
  end if;
  return pg_catalog.jsonb_build_object('id',v_new.id,'score',v_new.score,'total',v_new.total,
    'wrong_items',pg_catalog.to_jsonb(v_new.wrong_items),'submitted_at',v_new.created_at);
end;
$$;

create or replace function rice_private.teacher_results(p_teacher_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_class public.rice_classes%rowtype;
  v_records jsonb;
begin
  if p_teacher_key is null or pg_catalog.length(btrim(p_teacher_key))<>64 then
    raise exception '查閱碼錯誤';
  end if;
  select * into v_class from public.rice_classes where teacher_key=btrim(p_teacher_key);
  if not found then raise exception '查閱碼錯誤'; end if;
  -- COALESCE 是 PostgreSQL 條件運算式，不可寫成 pg_catalog.coalesce(...)。
  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', a.id,
      'seat_number', a.seat_number,
      'score', a.score,
      'total', a.total,
      'wrong_items', pg_catalog.to_jsonb(a.wrong_items),
      'submitted_at', a.created_at
    ) order by a.created_at,a.id), '[]'::jsonb
  ) into v_records
  from public.rice_attempts a where a.class_id=v_class.id;
  return pg_catalog.jsonb_build_object('class_name',v_class.name,'class_code',v_class.class_code,'records',v_records);
end;
$$;

-- 只有受限包裝器暴露在 /rest/v1/rpc/*；私有函式仍需最小化 EXECUTE 授權。
revoke all on function rice_private.lookup_class(text) from public, anon, authenticated;
revoke all on function rice_private.submit_attempt(text,integer,jsonb,uuid) from public, anon, authenticated;
revoke all on function rice_private.teacher_results(text) from public, anon, authenticated;
grant execute on function rice_private.lookup_class(text) to anon;
grant execute on function rice_private.submit_attempt(text,integer,jsonb,uuid) to anon;
grant execute on function rice_private.teacher_results(text) to anon;

create or replace function public.rice_lookup_class(p_code text)
returns jsonb language sql security invoker set search_path = '' as $$
 select rice_private.lookup_class(p_code);
$$;
create or replace function public.rice_submit_attempt(
 p_class_code text,p_seat_number integer,p_answers jsonb,p_client_run_id uuid
)
returns jsonb language sql security invoker set search_path = '' as $$
 select rice_private.submit_attempt(p_class_code,p_seat_number,p_answers,p_client_run_id);
$$;
create or replace function public.rice_teacher_results(p_teacher_key text)
returns jsonb language sql security invoker set search_path = '' as $$
 select rice_private.teacher_results(p_teacher_key);
$$;

revoke all on function public.rice_lookup_class(text) from public, anon, authenticated;
revoke all on function public.rice_submit_attempt(text,integer,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.rice_teacher_results(text) from public, anon, authenticated;
grant execute on function public.rice_lookup_class(text) to anon;
grant execute on function public.rice_submit_attempt(text,integer,jsonb,uuid) to anon;
grant execute on function public.rice_teacher_results(text) to anon;


-- 網站啟動時以匿名權限檢查：前端版本與 SQL 是否對應。
-- 不查詢班級或學生成績，所有訪客只會收到非敏感的服務版本資訊。
create or replace function public.rice_health_check()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'app', 'rice-magician',
    'schema_version', '2.1',
    'question_count', 12,
    'service', 'supabase'
  );
$$;
revoke all on function public.rice_health_check() from public, anon, authenticated;
grant execute on function public.rice_health_check() to anon;


-- =====================================================
-- 安裝階段 2：sql/05_enable_class_management.sql
-- =====================================================

-- 米粒魔術師 v2.3：啟用網頁新增班級（非破壞性增量更新）
-- 使用 Supabase SQL Editor 的高權限帳號執行；不刪除既有班級／作答紀錄。
-- 執行後下方會回傳「班級管理碼」：請保存，不要提交到 GitHub！
-- 再次執行本檔不會變更既有管理碼（回傳 NULL）。若遺失，執行 06_rotate_management_code.sql。

CREATE SCHEMA IF NOT EXISTS rice_private;
REVOKE ALL ON SCHEMA rice_private FROM PUBLIC;
GRANT USAGE ON SCHEMA rice_private TO anon;

CREATE TABLE IF NOT EXISTS rice_private.management_settings (
  singleton boolean PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  code_hash bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE rice_private.management_settings FROM PUBLIC, anon, authenticated;

-- SQL Editor 專用：初始化一次管理碼，僅儲存雜湊，不保存明碼。
CREATE OR REPLACE FUNCTION rice_private.bootstrap_management_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_code text;
BEGIN
  IF EXISTS (SELECT 1 FROM rice_private.management_settings) THEN RETURN NULL; END IF;
  v_code := pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-','')
         || pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-','');
  INSERT INTO rice_private.management_settings (singleton,code_hash)
    VALUES (TRUE,pg_catalog.sha256(pg_catalog.convert_to(v_code,'UTF8')))
    ON CONFLICT (singleton) DO NOTHING;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN v_code;
END;
$$;
REVOKE ALL ON FUNCTION rice_private.bootstrap_management_code() FROM PUBLIC, anon, authenticated;

-- 私有函式：先驗證高熵管理碼，再建立新班級並產生獨立教師查閱碼。
CREATE OR REPLACE FUNCTION rice_private.create_class(
  p_management_code text, p_class_code text, p_class_name text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_name text := pg_catalog.btrim(p_class_name);
  v_code text := pg_catalog.upper(pg_catalog.btrim(p_class_code));
  v_teacher_key text;
  v_hash bytea;
BEGIN
  IF p_management_code IS NULL OR p_management_code !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION '班級管理碼不正確';
  END IF;
  SELECT code_hash INTO v_hash FROM rice_private.management_settings WHERE singleton=TRUE;
  IF v_hash IS NULL OR v_hash <> pg_catalog.sha256(pg_catalog.convert_to(p_management_code,'UTF8')) THEN
    RAISE EXCEPTION '班級管理碼不正確';
  END IF;
  IF v_code IS NULL OR v_code !~ '^[A-Z0-9]{6,12}$' THEN
    RAISE EXCEPTION '班級代碼必須為 6 至 12 位英文字母或數字';
  END IF;
  IF v_name IS NULL OR pg_catalog.char_length(v_name) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION '班級名稱必須為 1 至 40 個字';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.rice_classes) >= 300 THEN
    RAISE EXCEPTION '班級數量已達上限';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rice_classes WHERE class_code=v_code) THEN
    RAISE EXCEPTION '班級代碼已存在';
  END IF;
  v_teacher_key := pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-','')
                || pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-','');
  INSERT INTO public.rice_classes (name,class_code,teacher_key)
    VALUES (v_name,v_code,v_teacher_key);
  RETURN pg_catalog.jsonb_build_object(
    'class_name',v_name,'class_code',v_code,'teacher_key',v_teacher_key
  );
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION '班級代碼已存在，請更換代碼後重試';
END;
$$;
REVOKE ALL ON FUNCTION rice_private.create_class(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rice_private.create_class(text,text,text) TO anon;

-- 僅透過受限 RPC 開放新增，不向 anon 開放直接 INSERT/SELECT 資料表。
CREATE OR REPLACE FUNCTION public.rice_create_class(
  p_management_code text, p_class_code text, p_class_name text
)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT rice_private.create_class(p_management_code,p_class_code,p_class_name);
$$;
REVOKE ALL ON FUNCTION public.rice_create_class(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rice_create_class(text,text,text) TO anon;


-- =====================================================
-- 安裝階段 3：sql/08_remember_device.sql
-- =====================================================

-- 米粒魔術師 v2.4：一次解鎖／記住此瀏覽器（非破壞性升級）
-- 先確認已執行 v2.3 的 05_enable_class_management.sql。本檔不會清除班級及成績。
-- 只須在 Supabase SQL Editor 執行一次；之後在網站內即可選擇是否記住裝置。

CREATE TABLE IF NOT EXISTS rice_private.management_device_tokens (
  token_hash bytea PRIMARY KEY,
  remembered boolean NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  CONSTRAINT rice_token_expiration CHECK (expires_at > issued_at)
);
REVOKE ALL ON TABLE rice_private.management_device_tokens FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_rice_management_token_expiry
  ON rice_private.management_device_tokens (expires_at);

-- 管理碼只在初次解鎖時傳輸；資料庫只儲存雜湊後的裝置憑證。
CREATE OR REPLACE FUNCTION rice_private.issue_management_token(
  p_management_code text, p_remember boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_hash bytea;
  v_token text;
  v_expires timestamptz;
  v_remember boolean := COALESCE(p_remember, FALSE);
BEGIN
  IF p_management_code IS NULL OR p_management_code !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION '班級管理碼不正確';
  END IF;
  SELECT code_hash INTO v_hash FROM rice_private.management_settings WHERE singleton = TRUE;
  IF v_hash IS NULL OR v_hash <> pg_catalog.sha256(pg_catalog.convert_to(p_management_code,'UTF8')) THEN
    RAISE EXCEPTION '班級管理碼不正確';
  END IF;
  DELETE FROM rice_private.management_device_tokens WHERE expires_at <= now();
  v_token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
          || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  v_expires := now() + CASE WHEN v_remember THEN interval '30 days' ELSE interval '4 hours' END;
  INSERT INTO rice_private.management_device_tokens(token_hash,remembered,expires_at)
    VALUES(pg_catalog.sha256(pg_catalog.convert_to(v_token,'UTF8')),v_remember,v_expires);
  RETURN pg_catalog.jsonb_build_object('token',v_token,'remembered',v_remember,'expires_at',v_expires);
END;
$$;
REVOKE ALL ON FUNCTION rice_private.issue_management_token(text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rice_private.issue_management_token(text,boolean) TO anon;

CREATE OR REPLACE FUNCTION rice_private.validate_management_token(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_expires timestamptz; v_remember boolean;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN
    RETURN pg_catalog.jsonb_build_object('valid',FALSE);
  END IF;
  SELECT expires_at,remembered INTO v_expires,v_remember
    FROM rice_private.management_device_tokens
   WHERE token_hash=pg_catalog.sha256(pg_catalog.convert_to(p_token,'UTF8')) AND expires_at>now();
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('valid',FALSE); END IF;
  RETURN pg_catalog.jsonb_build_object('valid',TRUE,'remembered',v_remember,'expires_at',v_expires);
END;
$$;
REVOKE ALL ON FUNCTION rice_private.validate_management_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rice_private.validate_management_token(text) TO anon;

CREATE OR REPLACE FUNCTION rice_private.revoke_management_token(p_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN RETURN FALSE; END IF;
  DELETE FROM rice_private.management_device_tokens
  WHERE token_hash=pg_catalog.sha256(pg_catalog.convert_to(p_token,'UTF8'));
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION rice_private.revoke_management_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rice_private.revoke_management_token(text) TO anon;

-- 直接沿用 v2.3 的班級資料表與驗證規則，新增方式改成授權憑證。
CREATE OR REPLACE FUNCTION rice_private.create_class_with_management_token(
  p_token text, p_class_code text, p_class_name text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_name text := pg_catalog.btrim(p_class_name);
  v_code text := pg_catalog.upper(pg_catalog.btrim(p_class_code));
  v_teacher_key text;
BEGIN
  IF (rice_private.validate_management_token(p_token)->>'valid') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '班級管理授權已過期或無效，請重新輸入管理碼';
  END IF;
  IF v_code IS NULL OR v_code !~ '^[A-Z0-9]{6,12}$' THEN
    RAISE EXCEPTION '班級代碼必須為 6 至 12 位英文字母或數字';
  END IF;
  IF v_name IS NULL OR pg_catalog.char_length(v_name) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION '班級名稱必須為 1 至 40 個字';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.rice_classes) >= 300 THEN
    RAISE EXCEPTION '班級數量已達上限';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rice_classes WHERE class_code=v_code) THEN
    RAISE EXCEPTION '班級代碼已存在';
  END IF;
  v_teacher_key := pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-','')
                || pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-','');
  INSERT INTO public.rice_classes (name,class_code,teacher_key) VALUES (v_name,v_code,v_teacher_key);
  UPDATE rice_private.management_device_tokens SET last_used_at=now()
   WHERE token_hash=pg_catalog.sha256(pg_catalog.convert_to(p_token,'UTF8'));
  RETURN pg_catalog.jsonb_build_object('class_name',v_name,'class_code',v_code,'teacher_key',v_teacher_key);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION '班級代碼已存在，請更換代碼後重試';
END;
$$;
REVOKE ALL ON FUNCTION rice_private.create_class_with_management_token(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rice_private.create_class_with_management_token(text,text,text) TO anon;

-- public RPC（使用 anon 呼叫）。不授予資料表直接讀寫權限。
CREATE OR REPLACE FUNCTION public.rice_management_unlock(p_management_code text,p_remember boolean)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT rice_private.issue_management_token(p_management_code,p_remember);
$$;
CREATE OR REPLACE FUNCTION public.rice_management_validate(p_token text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT rice_private.validate_management_token(p_token);
$$;
CREATE OR REPLACE FUNCTION public.rice_management_forget(p_token text)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT rice_private.revoke_management_token(p_token);
$$;
CREATE OR REPLACE FUNCTION public.rice_create_class_with_token(p_token text,p_class_code text,p_class_name text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT rice_private.create_class_with_management_token(p_token,p_class_code,p_class_name);
$$;
REVOKE ALL ON FUNCTION public.rice_management_unlock(text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rice_management_validate(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rice_management_forget(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rice_create_class_with_token(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rice_management_unlock(text,boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.rice_management_validate(text) TO anon;
GRANT EXECUTE ON FUNCTION public.rice_management_forget(text) TO anon;
GRANT EXECUTE ON FUNCTION public.rice_create_class_with_token(text,text,text) TO anon;

-- 使用者重設 64 碼管理碼時，既有 30 天信任裝置也必須全部失效。
CREATE OR REPLACE FUNCTION rice_private.rotate_management_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_code text;
BEGIN
  v_code := pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-','')
         || pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-','');
  INSERT INTO rice_private.management_settings (singleton,code_hash,updated_at)
    VALUES (TRUE,pg_catalog.sha256(pg_catalog.convert_to(v_code,'UTF8')),now())
    ON CONFLICT (singleton) DO UPDATE SET code_hash=EXCLUDED.code_hash,updated_at=EXCLUDED.updated_at;
  DELETE FROM rice_private.management_device_tokens;
  RETURN v_code;
END;
$$;
REVOKE ALL ON FUNCTION rice_private.rotate_management_code() FROM PUBLIC, anon, authenticated;


-- =====================================================
-- 安裝階段 4：建立預設班級 RICE401 (僅首次新安裝)
-- =====================================================

-- 米粒魔術師：建立／取得班級（可重複執行，不會重複新增）
-- 在 Supabase SQL Editor 執行，修改班級名稱與班級代碼後即可新增其他班。
-- 班級代碼需為 6–12 位大寫英數，請勿將教師查閱碼放進 GitHub。
-- ON CONFLICT 不會重設既有班級的查閱碼，避免重複執行就遺失原代碼。
INSERT INTO public.rice_classes (name, class_code, teacher_key)
VALUES (
  '四年甲班',
  'RICE401',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
ON CONFLICT (class_code) DO UPDATE
  SET name = EXCLUDED.name
RETURNING name AS "班級", class_code AS "學生班級代碼", teacher_key AS "教師成績查閱碼";

-- 同一代碼的名稱若不同會更新名稱，不會清除既有成績。
-- 建立另一班：修改上方的名稱及代碼，再執行一次。


-- =====================================================
-- 安裝階段 5：在交易提交前確認必要函式和權限
-- 任一檢查失敗，整次交易回滾，不留下半套安裝。
-- =====================================================
DO $rice_install_checks$
DECLARE
 v_sig text;
BEGIN
  IF public.rice_health_check()->>'schema_version' <> '2.1' THEN
    RAISE EXCEPTION '核心資料庫版本不符';
  END IF;
  FOREACH v_sig IN ARRAY ARRAY[
    'public.rice_lookup_class(text)',
    'public.rice_submit_attempt(text,integer,jsonb,uuid)',
    'public.rice_teacher_results(text)',
    'public.rice_create_class(text,text,text)',
    'public.rice_management_unlock(text,boolean)',
    'public.rice_management_validate(text)',
    'public.rice_management_forget(text)',
    'public.rice_create_class_with_token(text,text,text)'
  ] LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION '必要的資料庫函式缺失：%', v_sig;
    END IF;
    IF NOT has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION '匿名使用者缺少必要的 RPC 執行權限：%', v_sig;
    END IF;
  END LOOP;
  IF has_table_privilege('anon','public.rice_classes','SELECT')
     OR has_table_privilege('anon','public.rice_classes','INSERT')
     OR has_table_privilege('anon','public.rice_attempts','SELECT')
     OR has_table_privilege('anon','public.rice_attempts','INSERT')
     OR has_table_privilege('anon','rice_private.management_device_tokens','SELECT')
     OR has_table_privilege('anon','rice_private.management_settings','SELECT')
  THEN
     RAISE EXCEPTION '權限驗收失敗：匿名角色不應能直接存取資料表';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rice_classes WHERE class_code='RICE401') THEN
     RAISE EXCEPTION '預設班級未建立';
  END IF;
END;
$rice_install_checks$;

COMMIT;

-- 向 PostgREST 通知新公開函式已建立。
NOTIFY pgrst, 'reload schema';

-- 保持最後一個查詢結果為「管理碼 + 預設班級查閱碼」，方便一次保存。
-- 全新安裝時，管理碼只會在這次執行輸出；資料庫僅保存其雜湊。
WITH generated_management AS MATERIALIZED (
  SELECT rice_private.bootstrap_management_code() AS management_code
)
SELECT 'PASS' AS "安裝狀態",
       g.management_code AS "新班級管理碼_請立即保存",
       c.name AS "預設班級",
       c.class_code AS "學生班級代碼",
       c.teacher_key AS "教師成績查閱碼_請立即保存"
FROM generated_management g
CROSS JOIN public.rice_classes c
WHERE c.class_code='RICE401';
