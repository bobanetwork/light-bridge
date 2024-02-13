import { Wallet, providers } from 'ethers'
import { Bcfg } from '@eth-optimism/core-utils'
import * as dotenv from 'dotenv'
import Config from 'bcfg'

/* Imports: Core */
import { LightBridgeService } from '../service'

/* Imports: Config */
import { BobaChains } from '../utils/chains'

/* Imports: Interface */
import { ChainInfo, SupportedAssets } from '../utils/types'
import { AppDataSource } from '../data-source'
import { HistoryData } from '../entities/HistoryData.entity'
import { Init1687802800701 } from '../migrations/1687802800701-00_Init'
import { LastAirdrop } from '../entities/LastAirdrop.entity'
import { LastAirdrop1687802800701 } from '../migrations/1687802800701-01_LastAirdrop'

dotenv.config()

const main = async () => {
  if (!AppDataSource.isInitialized) {
    AppDataSource.setOptions({
      migrationsRun: true,
      logging: false,
      synchronize: false,
      entities: [HistoryData, LastAirdrop],
      migrations: [Init1687802800701, LastAirdrop1687802800701],
    })
    await AppDataSource.initialize() // initialize DB connection
  }
  console.log('Database initialized: ', AppDataSource.isInitialized)

  const config: Bcfg = new Config('teleportation')
  config.load({
    env: true,
    argv: true,
  })

  const env = process.env

  if (env.LIGHTBRIDGE_ENV !== 'dev' && env.LIGHTBRIDGE_ENV !== 'prod') {
    throw Error('must define env: LIGHTBRIDGE_ENV either dev or prod')
  }

  const envModeIsDevelopment = env.LIGHTBRIDGE_ENV === 'dev'

  const RPC_URL = config.str('l2-node-web3-url', env.RPC_URL)
  // This private key is used to send funds to the contract and initiate the tx,
  // so it should have enough BOBA balance
  const LIGHTBRIDGE_AWS_KMS_ACCESS_KEY = config.str(
    'teleportation-aws-kms-access-key',
    env.LIGHTBRIDGE_AWS_KMS_ACCESS_KEY
  )
  const LIGHTBRIDGE_AWS_KMS_SECRET_KEY = config.str(
    'teleportation-aws-kms-secret-key',
    env.LIGHTBRIDGE_AWS_KMS_SECRET_KEY
  )
  const LIGHTBRIDGE_AWS_KMS_KEY_ID = config.str(
    'teleportation-aws-kms-key-id',
    env.LIGHTBRIDGE_AWS_KMS_KEY_ID
  )
  const LIGHTBRIDGE_AWS_KMS_REGION = config.str(
    'teleportation-aws-kms-region',
    env.LIGHTBRIDGE_AWS_KMS_REGION
  )
  const LIGHTBRIDGE_AWS_KMS_ENDPOINT = config.str(
    'teleportation-aws-kms-endpoint',
    env.LIGHTBRIDGE_AWS_KMS_ENDPOINT
  )
  const LIGHTBRIDGE_AIRDROP_GAS_AMOUNT_WEI = config.str(
    'teleportation-airdrop-gas-amount-wei',
    env.LIGHTBRIDGE_AIRDROP_GAS_AMOUNT_WEI || '100000000000000' // 0.0001 eth
  )
  const LIGHTBRIDGE_AIRDROP_MIN_USD_VALUE = config.str(
    'teleportation-airdrop-min-usd-value',
    env.LIGHTBRIDGE_AIRDROP_MIN_USD_VALUE || '15'
  )
  const LIGHTBRIDGE_AIRDROP_COOLDOWN_SECONDS = config.str(
    'teleportation-airdrop-cooldown-seconds',
    env.LIGHTBRIDGE_AIRDROP_COOLDOWN_SECONDS || '86400'
  )
  const LIGHTBRIDGE_AIRDROP_ENABLED = config.bool(
    'teleportation-airdrop-enabled',
    env.LIGHTBRIDGE_AIRDROP_ENABLED?.toLowerCase() === 'true' || false
  )

  // Optional
  const POLLING_INTERVAL = config.uint(
    'polling-interval',
    parseInt(env.LIGHTBRIDGE_POLLING_INTERVAL, 10) || 1000 * 60
  )
  const BLOCK_RANGE_PER_POLLING = config.uint(
    'block-range-per-polling',
    parseInt(env.LIGHTBRIDGE_BLOCK_RANGE_PER_POLLING, 10) || 1000
  )

  if (!RPC_URL) {
    throw new Error('Must pass RPC_URL')
  }
  if (
    !LIGHTBRIDGE_AWS_KMS_ACCESS_KEY ||
    !LIGHTBRIDGE_AWS_KMS_SECRET_KEY ||
    !LIGHTBRIDGE_AWS_KMS_KEY_ID ||
    !LIGHTBRIDGE_AWS_KMS_ENDPOINT ||
    !LIGHTBRIDGE_AWS_KMS_REGION
  ) {
    throw new Error('Must pass TELEPORTATION AWS CONFIG ENV')
  }

  const l2Provider = new providers.StaticJsonRpcProvider(RPC_URL)

  // get all boba chains and exclude the current chain
  const chainId = (await l2Provider.getNetwork()).chainId
  const isTestnet = BobaChains[chainId].testnet
  let originSupportedAssets: SupportedAssets
  const selectedBobaChains: ChainInfo[] = Object.keys(BobaChains).reduce(
    (acc, cur) => {
      const chain = BobaChains[cur]
      if (isTestnet === chain.testnet) {
        if (Number(cur) !== chainId) {
          chain.provider = new providers.StaticJsonRpcProvider(chain.url)
          acc.push({ chainId: cur, ...chain })
        } else {
          originSupportedAssets = chain.supportedAssets
        }
      }
      return acc
    },
    []
  )
  const LIGHTBRIDGE_ADDRESS = BobaChains[chainId].teleportationAddress

  const service = new LightBridgeService({
    l2RpcProvider: l2Provider,
    chainId,
    teleportationAddress: LIGHTBRIDGE_ADDRESS,
    selectedBobaChains,
    ownSupportedAssets: originSupportedAssets,
    pollingInterval: POLLING_INTERVAL,
    blockRangePerPolling: BLOCK_RANGE_PER_POLLING,
    awsConfig: {
      awsKmsAccessKey: envModeIsDevelopment
        ? LIGHTBRIDGE_AWS_KMS_ACCESS_KEY
        : null,
      awsKmsSecretKey: envModeIsDevelopment
        ? LIGHTBRIDGE_AWS_KMS_SECRET_KEY
        : null,
      awsKmsKeyId: LIGHTBRIDGE_AWS_KMS_KEY_ID,
      awsKmsRegion: LIGHTBRIDGE_AWS_KMS_REGION,
      awsKmsEndpoint: envModeIsDevelopment
        ? LIGHTBRIDGE_AWS_KMS_ENDPOINT
        : null,
    },
    airdropConfig: {
      airdropAmountWei: LIGHTBRIDGE_AIRDROP_GAS_AMOUNT_WEI,
      airdropCooldownSeconds: LIGHTBRIDGE_AIRDROP_COOLDOWN_SECONDS,
      airdropEnabled: LIGHTBRIDGE_AIRDROP_ENABLED,
    },
  })

  await service.start()
}

if (require.main === module) {
  main()
}

export default main
