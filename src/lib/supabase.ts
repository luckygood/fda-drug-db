/** Supabase 数据源（周报/研发情报共享读取层） */
export const SUPABASE_URL = 'https://xtwqcjxtekoxuntpdsiq.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_E5YZTMxNds-Lh5BxjzK3nA_IaY_gd6s'

export interface WeeklyReport {
  id: number
  period: string
  batch: string | null
  generated_at: string
}

export async function supabaseGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  })
  if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）`)
  return res.json() as Promise<T>
}
