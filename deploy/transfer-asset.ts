import { BigNumber, Contract, ethers, providers, Wallet } from 'ethers'
import L1ERC20Json from '../artifacts/contracts/test-helpers/L1ERC20.sol/L1ERC20.json'

const hre = require('hardhat')
const prompt = require('prompt-sync')()

async function main() {

  console.log(`'Transfer tokens to provided address, ..`)
  const provider = hre.ethers.provider
  const network = hre.network
  const chainId = (await provider.getNetwork()).chainId

  console.log(`Network name=${network?.name}`)
  console.log(`Network chain id=${chainId}`)
  if (!network?.config?.accounts || !network?.config?.accounts?.length) {
    console.log('No private key supplied, aborting.')
    return
  }

  const deployer = new Wallet(network.config.accounts[0], provider)

  const TOKEN_ADDR = '0x4200000000000000000000000000000000000023'
  console.log('Network: ', chainId, network.name)
  console.log('Your token: ', TOKEN_ADDR)
  const continuePrompt = prompt('Please confirm you have configured your addresses correctly, continue? [y/N] ')
  if (continuePrompt?.toLowerCase() !== 'y') {
    console.log('Aborting, since addresses not yet set.')
    return
  }

  const Factory_ERC20 = new ethers.ContractFactory(
    L1ERC20Json.abi,
    L1ERC20Json.bytecode,
    deployer,
  )

  // change abi for proxy
  const ERC20 = new ethers.Contract(
    TOKEN_ADDR,
    Factory_ERC20.interface,
    deployer)

  const recipient = prompt('Who should receive the funds?')
  const prevBalance = await ERC20.balanceOf(deployer.address)
  console.log(`Trying to transfer balance of ${prevBalance} token to address: ${recipient}`)
  const confirmDisburserTransfer = prompt('Are you sure? [y/N]')
  if (confirmDisburserTransfer?.toLowerCase() !== 'y') {
    console.log('Aborting transfer.')
  } else {
    const res = await ERC20.transfer(recipient, prevBalance, { gasLimit: 12_000_000 })
    console.log(await res.wait())
    console.log('\nSuccessfully transferred!')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

