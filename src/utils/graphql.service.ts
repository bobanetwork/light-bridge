/*

TODO: Also add to boba-chains npm package

import {
    ApolloClient,
    DocumentNode,
    gql,
    HttpLink,
    InMemoryCache,
} from '@apollo/client'
import networkService from './networkService'
import { BigNumberish } from 'ethers'
import { NetworkDetailChainConfig } from '../util/network/config/network-details.types'
import {
    DepositState,
    WithdrawProcessStep,
    WithdrawState,
} from './anchorage.service'

//#region types
export type LightBridgeDisbursementEvents =
    | LightBridgeDisbursementSuccessEvent
    | LightBridgeDisbursementFailedEvent
    | LightBridgeDisbursementRetrySuccessEvent
export type LightBridgeAssetReceivedEvent = {
    __typename: 'TeleportationAssetReceivedEvent'
    token: string
    sourceChainId: string
    toChainId: string
    depositId: string
    emitter: string
    amount: BigNumberish
    transactionHash_: string
    block_number: string
    timestamp_: string
}

export type LightBridgeDisbursementSuccessEvent = {
    __typename: 'TeleportationDisbursementSuccessEvent'
    depositId: string
    to: string
    token: string
    amount: BigNumberish
    sourceChainId: string
    transactionHash_: string
    block_number: string
    timestamp_: string
}

export type LightBridgeDisbursementFailedEvent = {
    __typename: 'TeleportationDisbursementFailedEvent'
    depositId: string
    to: string
    amount: BigNumberish
    sourceChainId: string
    transactionHash_: string
    block_number: string
    timestamp_: string
}

export type LightBridgeDisbursementRetrySuccessEvent = {
    __typename: 'TeleportationDisbursementRetrySuccessEvent'
    depositId: string
    to: string
    amount: BigNumberish
    sourceChainId: string
    transactionHash_: string
    block_number: string
    timestamp_: string
}

export type GQPWithdrawalInitiatedEvent = {
    id: string
    to: string
    from: string
    contractId_: string
    timestamp_: string
    block_number: string
    transactionHash_: string
    l1Token: string
    l2Token: string
    amount: string
    extraData: string
}

export type GQL2ToL1MessagePassedEvent = {
    id: string
    block_number: string
    timestamp_: string
    transactionHash_: string
    contractId_: string
    nonce: string
    sender: string
    target: string
    value: string
    gasLimit: string
    data: string
    withdrawalHash: string
}

export type GQLWithdrawalFinalizedEvent = {
    id: string
    block_number: string
    timestamp_: string
    transactionHash_: string
    contractId_: string
    withdrawalHash: string
    success: string
}

export type GQLWithdrawalProvenEvent = {
    id: string
    block_number: string
    timestamp_: string
    transactionHash_: string
    withdrawalHash: string
    contractId_: string
    from: string
    to: string
}

export type GQLDepositFinalizedEvent = {
    id: string
    block_number: string
    timestamp_: number
    transactionHash_: string
    contractId_: string
    l1Token: string
    l2Token: string
    from: string
    to: string
    amount: string
    extraData: string
    __typename: DepositState
}
//#endregion

enum EGraphQLService {
    AnchorageBridge = 1,
    LightBridge = 2,
    DAO = 3,
}

class GraphQLService {
    GRAPHQL_ENDPOINTS = {
        // ETH Mainnet
        1: {
            [EGraphQLService.LightBridge]: {
                gql: 'https://api.goldsky.com/api/public/project_clq6jph4q9t2p01uja7p1f0c3/subgraphs/light-bridge-mainnet/v1/gn',
                local: '',
            },
        },
        // Arbitrum One
        42161: {
            [EGraphQLService.LightBridge]: {
                gql: 'https://api.goldsky.com/api/public/project_clq6jph4q9t2p01uja7p1f0c3/subgraphs/light-bridge-arbitrum-one/v1/gn',
                local: '',
            },
        },
        // Optimism Mainnet
        10: {
            [EGraphQLService.LightBridge]: {
                gql: 'https://api.goldsky.com/api/public/project_clq6jph4q9t2p01uja7p1f0c3/subgraphs/light-bridge-optimism/v1/gn',
                local: '',
            },
        },
        // Boba ETH
        288: {
            [EGraphQLService.DAO]: {
                gql: 'https://api.goldsky.com/api/public/project_clq6jph4q9t2p01uja7p1f0c3/subgraphs/dao-boba-eth/v1/gn',
                local: '',
            },
            [EGraphQLService.LightBridge]: {
                gql: 'https://api.goldsky.com/api/public/project_clq6jph4q9t2p01uja7p1f0c3/subgraphs/light-bridge-boba-eth/v1/gn',
                local: '',
            },
        },
        // Boba BNB
        56288: {
            [EGraphQLService.LightBridge]: {
                gql: 'https://api.goldsky.com/api/public/project_clq6jph4q9t2p01uja7p1f0c3/subgraphs/light-bridge-boba-bnb/v1/gn',
                local: '',
            },
        },
        // BSC
        56: {
            [EGraphQLService.LightBridge]: {
                gql: 'https://api.goldsky.com/api/public/project_clq6jph4q9t2p01uja7p1f0c3/subgraphs/light-bridge-bsc/v1/gn',
                local: '',
            },
        },
        // Goerli
        5: {
            [EGraphQLService.LightBridge]: {
                gql: 'https://api.goldsky.com/api/public/project_clq6jph4q9t2p01uja7p1f0c3/subgraphs/light-bridge-goerli/v1/gn',
                local: '',
            },
            [EGraphQLService.DAO]: {
                gql: 'https://api.goldsky.com/api/public/project_clq6jph4q9t2p01uja7p1f0c3/subgraphs/dao-boba-goerli/v1/gn',
                local: '',
            },
        },
        // BNB testnet
        97: {
            [EGraphQLService.LightBridge]: {
                gql: 'https://api.goldsky.com/api/public/project_clq6jph4q9t2p01uja7p1f0c3/subgraphs/light-bridge-chapel/v1/gn',
                local: '',
            },
        },
        // Boba Goerli
        2888: {
            [EGraphQLService.LightBridge]: {
                gql: 'https://api.goldsky.com/api/public/project_clq6jph4q9t2p01uja7p1f0c3/subgraphs/light-bridge-boba-goerli/v1/gn',
                local: 'http://127.0.0.1:8000/subgraphs/name/boba/Bridges',
            },
        },
        // Boba BNB testnet
        9728: {
            [EGraphQLService.LightBridge]: {
                gql: 'https://api.goldsky.com/api/public/project_clq6jph4q9t2p01uja7p1f0c3/subgraphs/light-bridge-boba-bnb-testnet/v1/gn',
                local: 'http://127.0.0.1:8002/subgraphs/name/boba/Bridges',
            },
        },
        // Arbitrum Goerli
        421613: {
            [EGraphQLService.LightBridge]: {
                gql: 'https://api.goldsky.com/api/public/project_clq6jph4q9t2p01uja7p1f0c3/subgraphs/light-bridge-arbitrum-goerli/v1/gn',
                local: '',
            },
        },
        // Optimism Goerli
        420: {
            [EGraphQLService.LightBridge]: {
                gql: 'https://api.goldsky.com/api/public/project_clq6jph4q9t2p01uja7p1f0c3/subgraphs/light-bridge-optimism-goerli/v1/gn',
                local: '',
            },
        },
        // Sepolia
        11155111: {
            [EGraphQLService.AnchorageBridge]: {
                gql: 'https://api.goldsky.com/api/public/project_clq6jph4q9t2p01uja7p1f0c3/subgraphs/anchorage-bridging-sepolia/v1/gn',
            },
            [EGraphQLService.LightBridge]: {
                gql: 'https://api.goldsky.com/api/public/project_clq6jph4q9t2p01uja7p1f0c3/subgraphs/light-bridge-sepolia/v1/gn',
                local: '',
            },
        },
        // Boba Sepolia
        28882: {
            [EGraphQLService.AnchorageBridge]: {
                gql: 'https://api.goldsky.com/api/public/project_clq6jph4q9t2p01uja7p1f0c3/subgraphs/anchorage-bridging-boba-sepolia/v1/gn',
            },
            [EGraphQLService.LightBridge]: {
                gql: 'https://api.goldsky.com/api/public/project_clq6jph4q9t2p01uja7p1f0c3/subgraphs/light-bridge-boba-sepolia/v1/gn',
                local: '',
            },
        },
    }

    getBridgeEndpoint = (chainId, service: EGraphQLService, useLocal = false) => {
        return this.GRAPHQL_ENDPOINTS[chainId][service][useLocal ? 'local' : 'gql']
    }

    async conductQuery(
        query: DocumentNode,
        variables = {},
        sourceChainId: BigNumberish,
        service: EGraphQLService,
        useLocalGraphEndpoint = false
    ) {
        const uri = this.getBridgeEndpoint(
            sourceChainId,
            service,
            useLocalGraphEndpoint
        )
        if (!uri) {
            return
        }
        const client = new ApolloClient({
            uri,
            link: new HttpLink({
                uri,
                fetch,
            }),
            cache: new InMemoryCache(),
        })

        return client.query({
            query,
            variables,
        })
    }
}

class LightBridgeGraphQLService extends GraphQLService {
    useLocal = false

    async queryAssetReceivedEvent(
        walletAddress: string,
        sourceChainId: BigNumberish
    ): Promise<LightBridgeAssetReceivedEvent[]> {
        const query =
            gql(`query Teleportation($wallet: String!, $sourceChainId: BigInt!) {
            assetReceiveds(
              where: {and: [{emitter_contains_nocase: $wallet}, { sourceChainId: $sourceChainId }]}
            ) {
              token
              sourceChainId
              toChainId
              depositId
              emitter
              amount
              block_number
              timestamp_
              transactionHash_
            }
          }`)

        const variables = {
            wallet: walletAddress,
            sourceChainId: sourceChainId.toString(),
        }

        return (
            await this.conductQuery(
                query,
                variables,
                sourceChainId,
                EGraphQLService.LightBridge,
                this.useLocal
            )
        )?.data?.assetReceiveds
    }

    async queryDisbursementSuccessEvent(
        walletAddress: string,
        sourceChainId: BigNumberish,
        destChainId: BigNumberish,
        token: string,
        amount: BigNumberish,
        depositId: BigNumberish
    ): Promise<LightBridgeDisbursementSuccessEvent | undefined> {
        if (!token) {
            return undefined
        }
        const query =
            gql(`query Teleportation($wallet: String!, $sourceChainId: BigInt!, $token: String!, $amount: String!, $depositId: String!) {
  disbursementSuccesses(
    where: { and: [{ to_contains_nocase: $wallet }, { sourceChainId: $sourceChainId }, { token_contains_nocase: $token }, { amount: $amount }, { depositId: $depositId }] }
  ) {
    depositId
    to
    token
    amount
    sourceChainId
    block_number
    timestamp_
    transactionHash_
  }
}
`)

        const variables = {
            wallet: walletAddress,
            sourceChainId: sourceChainId.toString(),
            token,
            amount: amount.toString(),
            depositId: depositId.toString(),
        }
        const events = (
            await this.conductQuery(
                query,
                variables,
                destChainId,
                EGraphQLService.LightBridge,
                this.useLocal
            )
        )?.data?.disbursementSuccesses
        if (events?.length) {
            return events[0] // just first (should always just be one)
        }
        return undefined
    }

    async queryDisbursementFailedEvent(
        sourceChainId: BigNumberish,
        destChainId: BigNumberish,
    ) {
        const query =
            gql(`query Teleportation($sourceChainId: BigInt!) {
  disbursementFaileds(
    where: { and: [{ sourceChainId: $sourceChainId }] }
  ) {
    depositId
    to
    amount
    sourceChainId
    block_number
    timestamp_
    transactionHash_
  }
}
`)

        const variables = {
            sourceChainId: sourceChainId.toString(),
        }
        const events = (
            await this.conductQuery(
                query,
                variables,
                destChainId,
                EGraphQLService.LightBridge,
                this.useLocal
            )
        )?.data?.disbursementFaileds
        if (events?.length) {
            if (events.length > 1) {
                console.warn(
                    'Found more than one disbursementFailedEvent, should always be 1:',
                    events
                )
            }
            return events[0] // just first (should always just be one)
        }
        return undefined
    }

    async queryDisbursementRetrySuccessEvent(
        walletAddress: string,
        sourceChainId: BigNumberish,
        destChainId: BigNumberish,
        amount: BigNumberish,
        depositId: BigNumberish
    ) {
        const query =
            gql(`query Teleportation($wallet: String!, $sourceChainId: BigInt!, $amount: String!, $depositId: String!) {
  disbursementRetrySuccesses(
    where: { and: [{ to_contains_nocase: $wallet }, { sourceChainId: $sourceChainId }, { amount: $amount }, { depositId: $depositId }] }
  ) {
    depositId
    to
    amount
    sourceChainId
    block_number
    timestamp_
    transactionHash_
  }
}
`)

        const variables = {
            wallet: walletAddress,
            sourceChainId: sourceChainId.toString(),
            amount: amount.toString(),
            depositId: depositId.toString(),
        }
        const events = (
            await this.conductQuery(
                query,
                variables,
                destChainId,
                EGraphQLService.LightBridge,
                this.useLocal
            )
        )?.data?.disbursementRetrySuccesses
        if (events?.length) {
            return events[0] // just first (should always just be one)
        }
        return undefined
    }
}

const lightBridgeGraphQLService = new LightBridgeGraphQLService()
export { lightBridgeGraphQLService }
*/
