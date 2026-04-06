import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://pskcnkzgoaqesjiohyth.supabase.co';
const supabaseAnonKey = 'sb_publishable_OZX0jnagvl8zfKdM42KlNg_5EsG0LTl';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
