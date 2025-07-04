import { Bcfg } from '@eth-optimism/core-utils'
import * as dotenv from 'dotenv'
import Config from 'bcfg'

/* Imports: Config */
import {
  BobaChains,
  IBobaChain,
  ChainInfo,
  ENetworkMode,
  ILightBridgeOpts,
} from '@bobanetwork/light-bridge-chains'

/* Imports: Interface */
import { startLightBridgeForNetwork } from './lightbridge-instance'

dotenv.config()

const main = async () => {
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
  const networkMode = config
    .str('teleportation-network-mode', env.LIGHTBRIDGE_MODE)
    ?.toLowerCase()

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

  // Optional
  const pollingInterval = config.uint(
    'polling-interval',
    parseInt(env.LIGHTBRIDGE_POLLING_INTERVAL, 10) || 60_000 // in ms, 1 minute = 60_000ms
  )
  const blockRangePerPolling = config.uint(
    'block-range-per-polling',
    parseInt(env.LIGHTBRIDGE_BLOCK_RANGE_PER_POLLING, 10) || 1000 // 1000 blocks
  )
  const retryIntervalMs = config.uint(
    'retry-interval-ms',
    parseInt(env.LIGHTBRIDGE_RETRY_INTERVAL_MS, 10) || 60_000
  )

  const enableExitFee = config.bool(
    'enable-exit-fee',
    env.LIGHTBRIDGE_ENABLE_EXIT_FEE?.toLowerCase() === 'true' || true
  )

  // only for testing (integration tests, otherwise real networks are being used)
  const localNetworks = env.__LOCAL_NETWORKS
    ? (JSON.parse(env.__LOCAL_NETWORKS) as ChainInfo[])
    : undefined

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

  if (!networkMode) {
    throw new Error(
      'Must pass LIGHTBRIDGE_MODE, either testnets or mainnets explicitly'
    )
  }
  const baseOpts: Omit<ILightBridgeOpts, 'rpcUrl'> = {
    enableExitFee,
    networkMode:
      networkMode === ENetworkMode.TESTNETS
        ? ENetworkMode.TESTNETS
        : ENetworkMode.MAINNETS,
    pollingInterval,
    blockRangePerPolling,
    envModeIsDevelopment,
    awsKmsConfig: {
      awsKmsAccessKey,
      awsKmsEndpoint,
      awsKmsKeyId,
      awsKmsRegion,
      awsKmsSecretKey,
    },
    retryIntervalMs,
  }

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
        mainNetwork: network as ChainInfo, // only applies to localNetwork
        selectedBobaNetworks: localNetworks?.filter(
          (f) => network.name !== f.name
        ),
      },
    }

    serviceWorkers.push(startLightBridgeForNetwork(networkConfig))
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
