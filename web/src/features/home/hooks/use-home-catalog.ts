/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { z } from 'zod'

import { useStatus } from '@/hooks/use-status'
import { parseHeaderNavModulesFromStatus } from '@/lib/nav-modules'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { getHomeCatalog } from '../api'
import type { HomeCatalog } from '../types'

const catalogSchema = z.object({
  models: z.array(
    z.object({ model_name: z.string(), icon: z.string().optional() })
  ),
  vendors: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        icon: z.string().optional(),
      })
    )
    .max(8),
})
const emptyCatalog: HomeCatalog = { models: [], vendors: [] }

export function useHomeCatalog(
  isAuthenticated: boolean
): HomeCatalog & { loading: boolean } {
  const { status, loading, fetching } = useStatus()
  const access = parseHeaderNavModulesFromStatus(status).pricing
  const allowed = access.enabled && (!access.requireAuth || isAuthenticated)
  const userID = useAuthStore((state) => state.auth.user?.id)
  const group = useAuthStore((state) => state.auth.user?.group)
  const sessionID = useAuthStore((state) => state.auth.session?.sid)
  const query = useQuery({
    queryKey: ['home-catalog', userID, group, sessionID],
    queryFn: async () => {
      const response = requireServerSuccess(await getHomeCatalog())
      return catalogSchema.parse(response.data)
    },
    enabled: !!status && allowed && access.requireAuth,
    staleTime: 5 * 60 * 1000,
  })
  const publicCatalog = useMemo(() => {
    const result = catalogSchema.safeParse(status?.home_catalog)
    return result.success ? result.data : undefined
  }, [status?.home_catalog])
  const catalog = access.requireAuth ? query.data : publicCatalog
  const pending = access.requireAuth ? query.isLoading : fetching

  return {
    ...(allowed && catalog ? catalog : emptyCatalog),
    loading: loading || (allowed && !catalog && pending),
  }
}
