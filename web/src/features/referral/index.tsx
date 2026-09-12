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

You should have received a copy of the GNU General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { CircleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatQuota } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { EarningsCard } from './components/earnings-card'
import { InvitedUsersCard } from './components/invited-users-card'
import { ReferralLinkCard } from './components/referral-link-card'
import { ReferralRulesCard } from './components/referral-rules-card'
import { ReferralStatsCard } from './components/referral-stats-card'
import { TransferDialog } from './components/transfer-dialog'
import { WithdrawalDialog } from './components/withdrawal-dialog'
import { WithdrawalsCard } from './components/withdrawals-card'
import {
  useReferralSummary,
  useInvitedUsers,
  useAffiliateLogs,
  useTransferAffiliateQuota,
} from './hooks'
import { generateAffiliateLink } from './lib/affiliate'

const INVITED_USERS_PAGE_SIZE = 10
const EARNINGS_PAGE_SIZE = 10

export function Referral() {
  const { t } = useTranslation()
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [withdrawalDialogOpen, setWithdrawalDialogOpen] = useState(false)
  const isAdmin = useAuthStore((state) => (state.auth.user?.role ?? 0) >= 10)
  const [invitedPage, setInvitedPage] = useState(1)
  const [earningsPage, setEarningsPage] = useState(1)

  const summaryQuery = useReferralSummary()
  const summary = summaryQuery.data
  const invitedQuery = useInvitedUsers(invitedPage, INVITED_USERS_PAGE_SIZE)
  const earningsQuery = useAffiliateLogs(earningsPage, EARNINGS_PAGE_SIZE)
  const transferMutation = useTransferAffiliateQuota()

  const complianceConfirmed = summary?.compliance_confirmed ?? false
  const hasRewards = (summary?.aff_quota ?? 0) > 0

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Referral Program')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-5'>
            {summaryQuery.isError && (
              <ErrorState onRetry={() => void summaryQuery.refetch()} />
            )}
            {summary && !complianceConfirmed ? (
              <Alert variant='destructive'>
                <AlertDescription>
                  {t(
                    'Referral rewards are disabled until the administrator confirms payment compliance.'
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            <ReferralStatsCard
              summary={summary ?? null}
              loading={summaryQuery.isLoading}
            />

            <div className='grid gap-4 lg:grid-cols-2 lg:items-start'>
              <ReferralLinkCard
                affCode={summary?.aff_code ?? ''}
                affiliateLink={
                  summary?.aff_code
                    ? generateAffiliateLink(summary.aff_code)
                    : ''
                }
                loading={summaryQuery.isLoading}
              />
              <ReferralRulesCard summary={summary ?? null} />
            </div>

            <div className='bg-muted/20 flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5'>
              <div className='flex items-center gap-2.5'>
                <CircleAlert className='text-muted-foreground size-4' />
                <div className='text-muted-foreground text-sm'>
                  {t(
                    'Only top-up rebates can be withdrawn. Registration rewards can only be transferred to balance.'
                  )}
                  <p className='mt-1'>
                    {t('Balance-only rewards')}:{' '}
                    {formatQuota(
                      Math.max(
                        0,
                        (summary?.aff_quota ?? 0) -
                          (summary?.aff_withdrawable_quota ?? 0)
                      )
                    )}
                  </p>
                </div>
              </div>
              <div className='flex shrink-0 flex-wrap gap-2'>
                <Button
                  variant='outline'
                  onClick={() => setTransferDialogOpen(true)}
                  disabled={!complianceConfirmed || !hasRewards}
                >
                  {t('Transfer to Balance')}
                </Button>
                <Button
                  onClick={() => setWithdrawalDialogOpen(true)}
                  disabled={
                    !complianceConfirmed ||
                    (summary?.aff_withdrawable_quota ?? 0) <= 0
                  }
                >
                  {t('Request withdrawal')}
                </Button>
              </div>
            </div>

            <InvitedUsersCard
              data={invitedQuery.data ?? null}
              loading={invitedQuery.isLoading}
              page={invitedPage}
              onPageChange={setInvitedPage}
            />

            <EarningsCard
              data={earningsQuery.data ?? null}
              loading={earningsQuery.isLoading}
              page={earningsPage}
              onPageChange={setEarningsPage}
            />
            <WithdrawalsCard />
            {isAdmin && <WithdrawalsCard admin />}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <TransferDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        onConfirm={async (quota) => {
          const result = await transferMutation.mutateAsync(quota)
          return result?.success ?? false
        }}
        availableQuota={summary?.aff_quota ?? 0}
        withdrawableQuota={summary?.aff_withdrawable_quota ?? 0}
        transferring={transferMutation.isPending}
      />
      {withdrawalDialogOpen && (
        <WithdrawalDialog
          availableQuota={summary?.aff_withdrawable_quota ?? 0}
          onOpenChange={setWithdrawalDialogOpen}
        />
      )}
    </>
  )
}
