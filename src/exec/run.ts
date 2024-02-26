import { Bcfg } from '@eth-optimism/core-utils'
import * as dotenv from 'dotenv'
import Config from 'bcfg'

/* Imports: Core */
import { IAirdropConfig, LightBridgeService } from '../service'

/* Imports: Config */
import { BobaChains, IBobaChain } from '../utils/chains'

/* Imports: Interface */
import { AppDataSource } from '../data-source'
import { HistoryData } from '../entities/HistoryData.entity'
import { Init1687802800701 } from '../migrations/1687802800701-00_Init'
import { LastAirdrop } from '../entities/LastAirdrop.entity'
import { LastAirdrop1687802800701 } from '../migrations/1687802800701-01_LastAirdrop'
import { ENetworkMode, ILightBridgeOpts } from './types'
import path from 'path'
import {
  lightBridgeWorkerFileName,
  startLightBridgeForNetwork,
} from './lightbridge-instance'
import { ChainInfo } from '../utils/types'
import { Chain } from '@ethereumjs/common'

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
  const networkMode = config.str(
    'teleportation-network-mode',
    env.LIGHTBRIDGE_MODE
  )

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
    parseInt(env.LIGHTBRIDGE_POLLING_INTERVAL, 10) || 100 * 60
  )
  const blockRangePerPolling = config.uint(
    'block-range-per-polling',
    parseInt(env.LIGHTBRIDGE_BLOCK_RANGE_PER_POLLING, 10) || 1000
  )

  // only for testing (integration tests, otherwise real networks are being used)
  const localNetworks = env.__LOCAL_NETWORKS
    ? (JSON.parse(env.__LOCAL_NETWORKS) as ChainInfo[])
    : undefined

  console.log('LOCAL NETWORKS INSIDE RUN is: ', localNetworks)

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
  if (!networkMode) {
    throw new Error(
      'Must pass LIGHTBRIDGE_MODE, either testnets or mainnets explicitly'
    )
  }
  const baseOpts: Omit<ILightBridgeOpts, 'rpcUrl'> = {
    networkMode:
      networkMode?.toLowerCase() === ENetworkMode.TESTNETS
        ? ENetworkMode.TESTNETS
        : ENetworkMode.MAINNETS,
    blockRangePerPolling,
    pollingInterval,
    envModeIsDevelopment,
    awsKmsConfig: {
      awsKmsAccessKey,
      awsKmsEndpoint,
      awsKmsKeyId,
      awsKmsRegion,
      awsKmsSecretKey,
    },
    airdropConfig: {
      airdropAmountWei,
      airdropEnabled,
      airdropCooldownSeconds,
    },
  }

  // const piscina = new Piscina({
  //   filename: path.resolve(__dirname, './workerWrapper.js'),
  //   workerData: { fullpath: lightBridgeWorkerFileName },
  // })
  const isTestnetMode = ENetworkMode.TESTNETS === networkMode
  // filter out the own chainid
  const networksToWatch: IBobaChain[] = localNetworks
    ? localNetworks
    : Object.values(BobaChains).filter(
        (n: IBobaChain) => n.testnet === isTestnetMode
      )
  console.log(
    'Watching networks:',
    networkMode,
    networksToWatch.map((n) => n.name)
  )

  const serviceWorkers = []
  for (const network of networksToWatch) {
    // base options hat localnetworks property
    // hier filtern, nach nur den anderen
    const networkConfig: ILightBridgeOpts = {
      ...baseOpts,
      rpcUrl: network.url,
      localNetworks: {
        mainNetwork: network,
        selectedBobaNetworks: localNetworks.filter(
          (f) => network.name !== f.name
        ),
      },
    }

    serviceWorkers.push(startLightBridgeForNetwork(networkConfig))
    /*serviceWorkers.push(
      piscina.run(networkConfig, { name: 'startLightBridgeForNetwork' })
    )*/
    console.log('Started light bridge service for network: ', network.name)
  }
  // TODO: For now just failing in general, reconsider this and introduce fallbacks? But maybe it's a good idea to just fail for all networks when one service fails
  await Promise.all(serviceWorkers)
  console.log('Ran all light bridge services.')
}

if (require.main === module) {
  main()
}

export default main
