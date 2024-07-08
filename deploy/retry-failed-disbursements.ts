import { BigNumber, Contract, ethers, providers, Wallet } from 'ethers'
import LightBridgeJson from '../artifacts/contracts/LightBridge.sol/LightBridge.json'
import { KMSSigner } from '@bobanetwork/aws-kms'
import { IKMSSignerConfig } from '@bobanetwork/light-bridge-chains'
import { Bcfg } from '@eth-optimism/core-utils'
import * as dotenv from 'dotenv'
import Config from 'bcfg'

dotenv.config()

const hre = require('hardhat')
const prompt = require('prompt-sync')()

const env = process.env
const config: Bcfg = new Config('teleportation')
config.load({
  env: true,
  argv: true,
})

// ADJUST DEPOSIT IDS HERE
const DEPOSIT_IDS = []
// Refer to readme.md for addresses of other networks.
const LIGHT_BRIDGE_ADDRESS = '0x3f7Da9C51138E0475aA26E80677d27A568cFD6b9'

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

const awsConfig: IKMSSignerConfig = {
  awsKmsAccessKey,
  awsKmsSecretKey,
  awsKmsKeyId,
  awsKmsRegion,
  awsKmsEndpoint,
}

async function main() {
  console.log(
    `Calling retryFailedDisbursements with following deposit IDs: ${DEPOSIT_IDS}`
  )

  const provider = hre.ethers.provider
  const network = hre.network
  const chainId = (await provider.getNetwork()).chainId

  console.log(`Network name=${network?.name}`)
  console.log(`Network chain id=${chainId}`)
  if (!network?.config?.accounts || !network?.config?.accounts?.length) {
    console.log('No private key supplied, aborting.')
    return
  }

  console.log('Network: ', chainId, network.name)
  console.log('Lightbridge Address', JSON.stringify(LIGHT_BRIDGE_ADDRESS))
  const continuePrompt = prompt(
    'Please confirm you have configured your addresses correctly, continue? [y/N] '
  )
  if (continuePrompt?.toLowerCase() !== 'y') {
    console.log('Aborting, since addresses not yet set.')
    return
  }

  const kmsSigner = new KMSSigner(awsConfig, false)

  const lightBridgeContract = new Contract(
    LIGHT_BRIDGE_ADDRESS,
    LightBridgeJson.abi
  ).connect(provider)

  let amount = 0

  for (let index = 0; index < DEPOSIT_IDS.length; index++) {
    const depositId = DEPOSIT_IDS[index]
    const failedDisbursements =
      await lightBridgeContract.failedNativeDisbursements(depositId)

    amount += failedDisbursements.disbursement.amount
  }

  console.log(`Transferring ${amount} ETH/Native to ${LIGHT_BRIDGE_ADDRESS}`)

  const retryDisburseNativeTx = await lightBridgeContract.retryDisburseNative(
    DEPOSIT_IDS
  )

  const transferFromTx = await kmsSigner.sendTxViaKMS(
    provider,
    LIGHT_BRIDGE_ADDRESS,
    BigNumber.from(amount),
    retryDisburseNativeTx
  )
  console.log(
    'Retry Disburse Native: ',
    JSON.stringify(await transferFromTx.wait())
  )

  console.log('Retry Disburse Native done...')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
