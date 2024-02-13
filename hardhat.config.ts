import { HardhatUserConfig } from 'hardhat/types'
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-waffle'

require('dotenv').config()

const config: HardhatUserConfig = {
  mocha: {
    timeout: 200000,
  },
  networks: {
    boba_sepolia: {
      url: 'https://sepolia.boba.network',
      accounts: [process.env.DEPLOYER_PK],
    },
    sepolia: {
      url: 'https://ethereum-sepolia.publicnode.com',
      accounts: [process.env.DEPLOYER_PK],
    },
    boba_goerli: {
      url: 'https://goerli.boba.network',
      accounts: [process.env.DEPLOYER_PK],
    },
    localhost: {
      url: 'http://localhost:9545',
      allowUnlimitedContractSize: true,
      timeout: 1800000,
      accounts: [
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      ],
    },
  },
  solidity: '0.8.9',
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
}

export default config
