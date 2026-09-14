// Client Supabase — import ES module direct depuis un CDN, pas de bundler.
// La clé publishable est conçue pour être publique (protégée par RLS côté serveur),
// même logique que les variables EXPO_PUBLIC_* de la version React Native.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jcefaxilcjcxoibpnjwx.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_gxmif-V_ATOV4yACXVgXGw_ScNg6S2q';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
