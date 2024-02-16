import { Wallet, providers } from 'ethers'
import { Bcfg } from '@eth-optimism/core-utils'
import * as dotenv from 'dotenv'
import Config from 'bcfg'

/* Imports: Core */
import {IAirdropConfig, LightBridgeService} from '../service'

/* Imports: Config */
import { BobaChains } from '../utils/chains'

/* Imports: Interface */
import { ChainInfo, SupportedAssets } from '../utils/types'
import { AppDataSource } from '../data-source'
import { HistoryData } from '../entities/HistoryData.entity'
import { Init1687802800701 } from '../migrations/1687802800701-00_Init'
import { LastAirdrop } from '../entities/LastAirdrop.entity'
import { LastAirdrop1687802800701 } from '../migrations/1687802800701-01_LastAirdrop'
import {IKMSSignerConfig} from "../utils/kms-signing";

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

  const rpcUrl = config.str('l2-node-web3-url', env.RPC_URL)
  // This private key is used to send funds to the contract and initiate the tx,
  // so it should have enough BOBA balance
  const awsKmsAccessKey = config.str(
    'teleportation-aws-kms-access-key',
    env.LIGHTBRIDGE_AWS_KMS_ACCESS_KEY
  )
  const awsKmsSecretKey = config.str(
    'teleportation-aws-kms-secret-key',
    env.LIGHTBRIDGE_AWS_KMS_SECRET_KEY
  )
  const awsKmsKeyId = config.str(
    'teleportation-aws-kms-key-id',
    env.LIGHTBRIDGE_AWS_KMS_KEY_ID
  )
  const awsKmsRegion = config.str(
    'teleportation-aws-kms-region',
    env.LIGHTBRIDGE_AWS_KMS_REGION
  )
  const awsKmsEndpoint = config.str(
    'teleportation-aws-kms-endpoint',
    env.LIGHTBRIDGE_AWS_KMS_ENDPOINT
  )
  const airdropAmountWei = config.str(
    'teleportation-airdrop-gas-amount-wei',
    env.LIGHTBRIDGE_AIRDROP_GAS_AMOUNT_WEI || '100000000000000' // 0.0001 eth
  )
  const airdropCooldownSeconds = config.str(
    'teleportation-airdrop-cooldown-seconds',
    env.LIGHTBRIDGE_AIRDROP_COOLDOWN_SECONDS || '86400'
  )
  const airdropEnabled = config.bool(
    'teleportation-airdrop-enabled',
    env.LIGHTBRIDGE_AIRDROP_ENABLED?.toLowerCase() === 'true' || false
  )

  // Optional
  const pollingInterval = config.uint(
    'polling-interval',
    parseInt(env.LIGHTBRIDGE_POLLING_INTERVAL, 10) || 1000 * 60
  )
  const blockRangePerPolling = config.uint(
    'block-range-per-polling',
    parseInt(env.LIGHTBRIDGE_BLOCK_RANGE_PER_POLLING, 10) || 1000
  )

  if (
    envModeIsDevelopment &&
    (!awsKmsAccessKey ||
      !awsKmsSecretKey ||
      !awsKmsKeyId ||
      !awsKmsEndpoint ||
      !awsKmsRegion)
  ) {
    throw new Error('Must pass LIGHTBRIDGE AWS CONFIG ENV')
  }

  // TODO: OPTIONS
  if (!rpcUrl) {
    throw new Error('Must pass RPC_URL')
  }
  await startLightBridgeForNetwork({rpcUrl, blockRangePerPolling, pollingInterval, envModeIsDevelopment,
    awsKmsConfig: {
      awsKmsAccessKey, awsKmsEndpoint, awsKmsKeyId, awsKmsRegion, awsKmsSecretKey
    },
    airdropConfig: {
      airdropAmountWei, airdropEnabled, airdropCooldownSeconds
    }
  })
}

interface ILightBridgeOpts {
  envModeIsDevelopment: boolean;
  rpcUrl: string;
  pollingInterval: number;
  blockRangePerPolling: number;
  awsKmsConfig: IKMSSignerConfig;
  airdropConfig?: IAirdropConfig;
}

const startLightBridgeForNetwork = async (opts: ILightBridgeOpts) => {
  const {rpcUrl, pollingInterval, blockRangePerPolling, envModeIsDevelopment, awsKmsConfig, airdropConfig} = opts;

  const l2RpcProvider = new providers.StaticJsonRpcProvider(rpcUrl)

  // get all boba chains and exclude the current chain
  const chainId = (await l2RpcProvider.getNetwork()).chainId
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
  const teleportationAddress = BobaChains[chainId].teleportationAddress

  const service = new LightBridgeService({
    l2RpcProvider,
    chainId,
    teleportationAddress,
    selectedBobaChains,
    ownSupportedAssets: originSupportedAssets,
    pollingInterval: pollingInterval,
    blockRangePerPolling: blockRangePerPolling,
    awsConfig: {
      awsKmsAccessKey: envModeIsDevelopment
          ? awsKmsConfig.awsKmsAccessKey
          : null,
      awsKmsSecretKey: envModeIsDevelopment
          ? awsKmsConfig.awsKmsSecretKey
          : null,
      awsKmsKeyId: awsKmsConfig.awsKmsKeyId,
      awsKmsRegion: awsKmsConfig.awsKmsRegion,
      awsKmsEndpoint: envModeIsDevelopment
          ? awsKmsConfig.awsKmsEndpoint
          : null,
    },
    airdropConfig,
  })

  await service.start()
}

if (require.main === module) {
  main()
}

export default main
