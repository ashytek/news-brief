import type { createClient } from '@/lib/supabase/client'

/** The browser Supabase client (a singleton per page load). */
export type Supabase = ReturnType<typeof createClient>
