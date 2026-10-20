/*
 * GitHub Pages 公開設定；只能填入 Supabase Project URL 與 publishable/anon key。
 * 禁止放入 service_role、secret key、教師查閱碼或任何密碼。
 * 留白時啟動本機示範模式，不會寫入正式資料庫。
 */
window.RICE_CONFIG = Object.freeze({
  supabaseUrl: '',
  supabaseAnonKey: ''
});
