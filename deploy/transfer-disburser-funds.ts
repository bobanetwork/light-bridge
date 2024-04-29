import {BigNumber, Contract, ethers, providers, Wallet} from 'ethers'
import L1ERC20Json from '../artifacts/contracts/test-helpers/L1ERC20.sol/L1ERC20.json'
import { KMSSigner } from '@bobanetwork/aws-kms'
import { IKMSSignerConfig } from '@bobanetwork/light-bridge-chains'
import { Bcfg } from '@eth-optimism/core-utils'
import * as dotenv from 'dotenv'
import Config from 'bcfg'

dotenv.config()

const hre = require("hardhat")
const prompt = require("prompt-sync")()

const env = process.env
const config: Bcfg = new Config('teleportation')
config.load({
    env: true,
    argv: true,
})

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

    console.log(`'Transfer disburser funds to new disburser wallet ..`)
    const provider = hre.ethers.provider
    const network = hre.network
    const chainId = (await provider.getNetwork()).chainId

    console.log(`Network name=${network?.name}`)
    console.log(`Network chain id=${chainId}`)
    if (!network?.config?.accounts || !network?.config?.accounts?.length) {
        console.log('No private key supplied, aborting.')
        return;
    }

    const ADDRESSES = {
        OLD_DISBURSER: '',
        NEW_DISBURSER: '',
        TOKEN_ADDRESS: '', // 0x0 for native
    }
    console.log("Network: ", chainId, network.name)
    console.log("Your addresses: ", JSON.stringify(ADDRESSES))
    const continuePrompt = prompt("Please confirm you have configured your addresses correctly, continue? [y/N] ")
    if (continuePrompt?.toLowerCase() !== 'y') {
        console.log('Aborting, since addresses not yet set.')
        return;
    }
    
    const kmsSigner = new KMSSigner(
      awsConfig,
      false,
    )

    if (ADDRESSES.TOKEN_ADDRESS === ethers.constants.AddressZero) {
        // TODO: gas payment not forget
    } else {

        const tokenContract = new Contract(ADDRESSES.TOKEN_ADDRESS, L1ERC20Json.abi).connect(provider)
        const tokenBalance = await tokenContract.balanceOf(ADDRESSES.OLD_DISBURSER)

        const transferFromTxUnsigned =
          await tokenContract.populateTransaction.transferFrom(
            ADDRESSES.OLD_DISBURSER,
            ADDRESSES.NEW_DISBURSER,
            tokenBalance,
          )
        const transferFromTx = await kmsSigner.sendTxViaKMS(
          provider,
          ADDRESSES.TOKEN_ADDRESS,
          BigNumber.from('0'),
          transferFromTxUnsigned
        )
        console.log("Transferred token: ", JSON.stringify(await transferFromTx.wait()))

    }

    console.log('Fund transfer done')
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

