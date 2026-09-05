import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env?.VITE_SUPABASE_URL ||
  "https://pskcnkzgoaqesjiohyth.supabase.co";

const supabaseAnonKey =
  import.meta.env?.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_OZX0jnagvl8zfKdM42KlNg_5EsG0LTl";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
