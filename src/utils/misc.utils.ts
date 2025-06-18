import { BigNumber } from 'ethers'
import { BobaChains } from '@bobanetwork/light-bridge-chains'
import { lightBridgeGraphQLService } from '@bobanetwork/graphql-utils'
import { gql } from '@apollo/client/core'
import { EGraphQLService } from '@bobanetwork/graphql-utils'

export const delay = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const deductExitFeeIfApplicable = (
  enableExitFee: boolean,
  serviceChainId: number,
  amount: BigNumber
): BigNumber => {
  // deduct fee for L1 networks or not Boba Foundation owned networks (basically fee is applied to all networks that have no airdrop support)
  if (
    enableExitFee &&
    !BobaChains[serviceChainId]?.airdropConfig?.airdropEnabled
  ) {
    return amount.mul(99).div(100)
  }
  return amount
}

/**
 * Check if there have been recent disbursements to a target wallet
 * @param walletAddress - The wallet address to check
 * @param chainId - The chain ID to query on
 * @param cooldownSeconds - Cooldown period in seconds (default 24 hours)
 * @returns true if recent disbursements found, false otherwise
 */
export async function hasRecentAirdrop(
  walletAddress: string,
  chainId: number,
  cooldownSeconds: number = 86400 // 24 hours default
): Promise<boolean> {
  try {
    const currentTimestamp = Math.floor(Date.now() / 1000)
    const cooldownStartTimestamp = currentTimestamp - cooldownSeconds

    console.log(
      `Checking airdrop cooldown for ${walletAddress} - querying disbursements`
    )

    const query = gql`
      query GetDisbursements($toAddr: String!) {
        disbursementSuccesses(
          where: { to: $toAddr }
          first: 10
          orderBy: timestamp_
          orderDirection: desc
        ) {
          id
          to
          timestamp_
        }
      }
    `

    const variables = {
      toAddr: walletAddress.toLowerCase(),
    }

    const result = await lightBridgeGraphQLService.conductQuery(
      query,
      variables,
      chainId,
      EGraphQLService.LightBridge
    )

    // Check if we have valid data
    if (
      !result ||
      !result.data ||
      !Array.isArray(result.data.disbursementSuccesses)
    ) {
      console.warn(
        `GraphQL query returned invalid data for airdrop cooldown check: ${walletAddress}. Assuming no recent activity.`
      )
      console.log(
        `Airdrop cooldown check completed for ${walletAddress} - no recent activity, allowing airdrop`
      )
      return false
    }

    const recentDisbursements =
      result.data.disbursementSuccesses.filter((event: any) => {
        const eventTimestamp = parseInt(event.timestamp_?.toString() || '0')
        return eventTimestamp >= cooldownStartTimestamp
      }) || []

    const hasRecentDisbursement = recentDisbursements.length > 0

    console.log(
      `Airdrop cooldown check completed for ${walletAddress} - ${
        hasRecentDisbursement
          ? 'recent activity found, blocking airdrop'
          : 'no recent activity, allowing airdrop'
      }`
    )

    return hasRecentDisbursement
  } catch (error) {
    console.warn(
      `Error checking airdrop cooldown for ${walletAddress}:`,
      error.message
    )
    // On error, be conservative and assume no recent airdrop (allow airdrop)
    console.log(
      `Airdrop cooldown check completed for ${walletAddress} - error occurred, allowing airdrop`
    )
    return false
  }
}
