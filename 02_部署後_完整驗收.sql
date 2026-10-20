-- v2.1 資料庫整合驗收：在 Supabase SQL Editor 執行，所有測試資料會 ROLLBACK。
-- 本檔不會更動既有的正式學生成績。
BEGIN;
DO $test$
DECLARE
  class_code text := 'T' || upper(substr(md5(random()::text),1,9));
  review_key text := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  run_id uuid := gen_random_uuid();
  answer_key jsonb := '["yes","no","yes","no","yes","no","yes","no","yes","no","yes","no"]'::jsonb;
  r jsonb;
  t jsonb;
BEGIN
  IF NOT has_function_privilege('anon','public.rice_health_check()','EXECUTE')
    OR NOT has_function_privilege('anon','public.rice_lookup_class(text)','EXECUTE')
    OR NOT has_function_privilege('anon','public.rice_submit_attempt(text,integer,jsonb,uuid)','EXECUTE')
    OR NOT has_function_privilege('anon','public.rice_teacher_results(text)','EXECUTE')
  THEN RAISE EXCEPTION '檢查失敗：anon 缺少必要的 RPC 權限'; END IF;

  IF has_table_privilege('anon','public.rice_classes','SELECT')
    OR has_table_privilege('anon','public.rice_classes','INSERT')
    OR has_table_privilege('anon','public.rice_attempts','SELECT')
    OR has_table_privilege('anon','public.rice_attempts','INSERT')
  THEN RAISE EXCEPTION '檢查失敗：匿名使用者不應直接查詢或新增資料表'; END IF;

  IF (SELECT public.rice_health_check()->>'schema_version') <> '2.1'
  THEN RAISE EXCEPTION '檢查失敗：SQL 版本不正確'; END IF;

  INSERT INTO public.rice_classes(name,class_code,teacher_key)
  VALUES ('測試班級（自動回滾）',class_code,review_key);

  r := public.rice_lookup_class(class_code);
  IF r->>'class_name' <> '測試班級（自動回滾）'
  THEN RAISE EXCEPTION '檢查失敗：班級查詢'; END IF;

  r := public.rice_submit_attempt(class_code,3,answer_key,run_id);
  IF (r->>'score')::integer <> 12
  THEN RAISE EXCEPTION '檢查失敗：伺服器判分'; END IF;

  -- 同一 UUID 重試不能重複新增。
  PERFORM public.rice_submit_attempt(class_code,3,answer_key,run_id);
  IF (SELECT count(*) FROM public.rice_attempts WHERE client_run_id=run_id) <> 1
  THEN RAISE EXCEPTION '檢查失敗：重複送出防護'; END IF;

  t := public.rice_teacher_results(review_key);
  IF jsonb_array_length(t->'records') <> 1
  THEN RAISE EXCEPTION '檢查失敗：教師查閱結果'; END IF;

  RAISE NOTICE 'PASS：RPC 執行權限、資料表禁用匿名直存、班級查詢、伺服器判分、防止重複、班級查閱。';
END
$test$;
ROLLBACK;
-- 若看到 PASS 訊息且沒有 Error，就是 SQL 安裝驗收成功。

-- 除了核心功能測試，加入 v2.3／v2.4 的資料結構與授權檢查。
-- 下列 SQL 只讀取系統目錄，不新增、修改或刪除正式資料。
WITH checks(label,passed) AS (
  VALUES
    ('核心健康檢查', public.rice_health_check()->>'schema_version'='2.1'),
    ('公開查詢班級 RPC', to_regprocedure('public.rice_lookup_class(text)') IS NOT NULL),
    ('提交測驗 RPC', to_regprocedure('public.rice_submit_attempt(text,integer,jsonb,uuid)') IS NOT NULL),
    ('班級成績查閱 RPC', to_regprocedure('public.rice_teacher_results(text)') IS NOT NULL),
    ('網頁新增班級 RPC', to_regprocedure('public.rice_create_class(text,text,text)') IS NOT NULL),
    ('記住裝置解鎖 RPC', to_regprocedure('public.rice_management_unlock(text,boolean)') IS NOT NULL),
    ('裝置授權驗證 RPC', to_regprocedure('public.rice_management_validate(text)') IS NOT NULL),
    ('裝置授權撤銷 RPC', to_regprocedure('public.rice_management_forget(text)') IS NOT NULL),
    ('以裝置憑證建班 RPC', to_regprocedure('public.rice_create_class_with_token(text,text,text)') IS NOT NULL),
    ('管理碼雜湊表', to_regclass('rice_private.management_settings') IS NOT NULL),
    ('裝置憑證雜湊表', to_regclass('rice_private.management_device_tokens') IS NOT NULL),
    ('管理碼已初始化', EXISTS (SELECT 1 FROM rice_private.management_settings)),
    ('預設班級存在', EXISTS (SELECT 1 FROM public.rice_classes WHERE class_code='RICE401')),
    ('匿名不可直接讀取班級', NOT has_table_privilege('anon','public.rice_classes','SELECT')),
    ('匿名不可直接讀取成績', NOT has_table_privilege('anon','public.rice_attempts','SELECT')),
    ('匿名不可直接新增班級', NOT has_table_privilege('anon','public.rice_classes','INSERT')),
    ('匿名不可直接新增成績', NOT has_table_privilege('anon','public.rice_attempts','INSERT'))
)
SELECT label AS "檢查項目",
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS "結果"
FROM checks ORDER BY label;
