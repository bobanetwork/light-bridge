export interface IBobaChains {
  [chainId: number]: {
    url: string
    testnet: boolean
    name: string
    teleportationAddress: string
    height: number
    supportedAssets: {
      [address: string]: string // symbol (MUST BE UNIQUE)
    }
  }
}

export enum Asset {
  ETH = 'ethereum',
  BOBA = 'boba-network',
  USDT = 'tether',
  BNB = 'binancecoin',
}

/**
 * @dev Chain configs
 * @property supportedAssets: BOBA as fee token only supported for EOAs, since Teleporter consists of a contract & the disburser wallet (assuming ETH fee) everything with 0x0 should be fine.
 **/
export const BobaChains: IBobaChains = {
  // TODO: Consider using AddressManager or AddressPackage instead

  //#region boba_networks
  288: {
    // TODO: seemingly no public graph node available (would require hosted_service or deploying it ourselves) --> boba listed though, but requires a hosted service
    url:
      process.env.LIGHTBRIDGE_RPC_BOBAETHMAINNET ??
      'https://boba-ethereum.gateway.tenderly.co',
    testnet: false,
    name: 'Boba Ethereum Mainnet',
    teleportationAddress: '0xd68809330075C792C171C450B983F4D18128e9BF',
    height: 873302,
    supportedAssets: {
      ['0x0000000000000000000000000000000000000000'.toLowerCase()]: Asset.ETH,
      ['0xa18bF3994C0Cc6E3b63ac420308E5383f53120D7'.toLowerCase()]: Asset.BOBA,
      ['0x5DE1677344D3Cb0D7D465c10b72A8f60699C062d'.toLowerCase()]: Asset.USDT,
      ['0x68ac1623ACf9eB9F88b65B5F229fE3e2c0d5789e'.toLowerCase()]: Asset.BNB,
    },
  },
  56288: {
    // TODO: seemingly no public graph node available (would require hosted_service or deploying it ourselves)
    url:
      process.env.LIGHTBRIDGE_RPC_BOBABNBMAINNET ??
      'https://replica.bnb.boba.network',
    testnet: false,
    name: 'Boba BNB Mainnet',
    teleportationAddress: '0xd68809330075C792C171C450B983F4D18128e9BF',
    height: 3393,
    supportedAssets: {
      ['0x4200000000000000000000000000000000000023'.toLowerCase()]: Asset.BNB,
      ['0x0000000000000000000000000000000000000000'.toLowerCase()]: Asset.BOBA,
    },
  },
  2888: {
    // TODO: seemingly no public graph node available (would require hosted_service or deploying it ourselves)
    url:
      process.env.LIGHTBRIDGE_RPC_BOBAETHGOERLI ??
      'https://replica.goerli.boba.network',
    testnet: true,
    name: 'Boba Ethereum Goerli',
    teleportationAddress: '0xB43EE846Aa266228FeABaD1191D6cB2eD9808894',
    height: 40822,
    supportedAssets: {
      ['0x0000000000000000000000000000000000000000'.toLowerCase()]: Asset.ETH,
      ['0x4200000000000000000000000000000000000023'.toLowerCase()]: Asset.BOBA,
    },
  },
  9728: {
    // TODO: seemingly no public graph node available (would require hosted_service or deploying it ourselves)
    url:
      process.env.LIGHTBRIDGE_RPC_BOBABNBTESTNET ??
      'https://boba-bnb-testnet.gateway.tenderly.co',
    testnet: true,
    name: 'Boba BNB Testnet',
    teleportationAddress: '0xf4d179d3a083Fa3Eede935FaF4C679D32d514186',
    height: 295353,
    supportedAssets: {
      ['0x4200000000000000000000000000000000000023'.toLowerCase()]: Asset.BNB,
      ['0x0000000000000000000000000000000000000000'.toLowerCase()]: Asset.BOBA,
      ['0xc614A66f82e71758Fa7735C91dAD1088c8362f15'.toLowerCase()]: Asset.ETH,
    },
  },
  421613: {
    url:
      process.env.LIGHTBRIDGE_RPC_ARBITRUMGOERLI ??
      'https://arbitrum-goerli.public.blastapi.io',
    testnet: true,
    name: 'Arbitrum Goerli',
    teleportationAddress: '0x7063f59e1Db3e505D844d11A71C78F92D39E5963',
    height: 53880808,
    supportedAssets: {
      ['0x0000000000000000000000000000000000000000'.toLowerCase()]: Asset.ETH,
    },
  },
  420: {
    url:
      process.env.LIGHTBRIDGE_RPC_OPTIMISMGOERLI ??
      'https://optimism-goerli.publicnode.com',
    testnet: true,
    name: 'Optimism Goerli',
    teleportationAddress: '0xC226F132A686A08018431C913d87693396246024',
    height: 17010097,
    supportedAssets: {
      ['0x0000000000000000000000000000000000000000'.toLowerCase()]: Asset.ETH,
    },
  },
  42161: {
    // TODO: seemingly no public graph node available (would require hosted_service or deploying it ourselves)
    url:
      process.env.LIGHTBRIDGE_RPC_ARBITRUMMAINNET ??
      'https://arbitrum.llamarpc.com',
    testnet: false,
    name: 'Arbitrum Mainnet',
    teleportationAddress: '0xd68809330075C792C171C450B983F4D18128e9BF',
    height: 3393,
    supportedAssets: {
      ['0x0000000000000000000000000000000000000000'.toLowerCase()]: Asset.ETH,
    },
  },
  10: {
    // TODO: seemingly no public graph node available (would require hosted_service or deploying it ourselves)
    url:
      process.env.LIGHTBRIDGE_RPC_OPTIMISMMAINNET ??
      'https://optimism.llamarpc.com',
    testnet: false,
    name: 'Optimism Mainnet',
    teleportationAddress: '0xd68809330075C792C171C450B983F4D18128e9BF',
    height: 3393,
    supportedAssets: {
      ['0x0000000000000000000000000000000000000000'.toLowerCase()]: Asset.ETH,
    },
  },
  //#endregion
  //#region l1
  1: {
    // TODO: Public nodes available, deploy once contract is live
    url: process.env.LIGHTBRIDGE_RPC_ETHMAINNET ?? 'https://eth.llamarpc.com',
    testnet: false,
    name: 'Ethereum Mainnet',
    teleportationAddress: '0x0',
    height: 17565090,
    supportedAssets: {
      ['0x0000000000000000000000000000000000000000'.toLowerCase()]: Asset.ETH,
      ['0x42bBFa2e77757C645eeaAd1655E0911a7553Efbc'.toLowerCase()]: Asset.BOBA,
      ['0xdAC17F958D2ee523a2206206994597C13D831ec7'.toLowerCase()]: Asset.USDT,
      ['0xB8c77482e45F1F44dE1745F52C74426C631bDD52'.toLowerCase()]: Asset.BNB,
    },
  },
  56: {
    // TODO: Public nodes available, deploy once contract is live
    url: process.env.LIGHTBRIDGE_RPC_BNBMAINNET ?? 'https://rpc.ankr.com/bsc',
    testnet: false,
    name: 'BNB Mainnet',
    teleportationAddress: '0x0',
    height: 30907682,
    supportedAssets: {
      /*'0x0000000000000000000000000000000000000000': 'ETH',
      '0x42bBFa2e77757C645eeaAd1655E0911a7553Efbc': 'BOBA',
      '0xdAC17F958D2ee523a2206206994597C13D831ec7': 'USDT',
      '0xB8c77482e45F1F44dE1745F52C74426C631bDD52': 'BNB',*/
    },
  },
  // Sepolia
  11155111: {
    url:
      process.env.LIGHTBRIDGE_RPC_SEPOLIATESTNET ??
      'https://ethereum-sepolia.publicnode.com',
    testnet: true,
    name: 'Sepolia Testnet',
    teleportationAddress: '0xaeE12b8D99BBff7ED47866DF868CF5b4b3F73ffF',
    height: 5280795,
    supportedAssets: {
      ['0x0000000000000000000000000000000000000000'.toLowerCase()]: Asset.ETH,
      ['0x33faF65b3DfcC6A1FccaD4531D9ce518F0FDc896'.toLowerCase()]: Asset.BOBA,
    },
  },
  // Boba Sepolia
  28882: {
    url:
      process.env.LIGHTBRIDGE_RPC_BOBASEPOLIATESTNET ??
      'https://sepolia.boba.network',
    testnet: true,
    name: 'Boba Sepolia Testnet',
    teleportationAddress: '0x2dE73Bd1660Fbf4D521a52Ec2a91CCc106113801',
    height: 19220000, // TODO: might need to be adapted
    supportedAssets: {
      ['0x0000000000000000000000000000000000000000'.toLowerCase()]: Asset.ETH,
      ['0x4200000000000000000000000000000000000023'.toLowerCase()]: Asset.BOBA,
    },
  },
  5: {
    url:
      process.env.LIGHTBRIDGE_RPC_GOERLITESTNET ??
      'https://rpc.ankr.com/eth_goerli',
    testnet: true,
    name: 'Goerli Testnet',
    teleportationAddress: '0x84b22166366a6f7E0cD0c3ce9998f2913Bf17A13',
    height: 9484025,
    supportedAssets: {
      ['0x0000000000000000000000000000000000000000'.toLowerCase()]: Asset.ETH,
      ['0xC2C527C0CACF457746Bd31B2a698Fe89de2b6d49'.toLowerCase()]: Asset.USDT,
      ['0xFC1C82c5EdeB51082CF30FDDb434D2cBDA1f6924'.toLowerCase()]: Asset.BNB,
      ['0xeCCD355862591CBB4bB7E7dD55072070ee3d0fC1'.toLowerCase()]: Asset.BOBA,
    },
  },
  97: {
    url:
      process.env.LIGHTBRIDGE_RPC_BNBTESTNET ??
      'https://api.zan.top/node/v1/bsc/testnet/public',
    testnet: true,
    name: 'BNB Testnet',
    teleportationAddress: '0x7f6a32bCaA70c65E08F2f221737612F6fC18347A',
    height: 32272487,
    supportedAssets: {
      ['0x0000000000000000000000000000000000000000'.toLowerCase()]: Asset.BNB,
      ['0x875cD11fDf085e0E11B0EE6b814b6d0b38fA554C'.toLowerCase()]: Asset.BOBA,
      ['0xd66c6B4F0be8CE5b39D52E0Fd1344c389929B378'.toLowerCase()]: Asset.ETH, // WETH
    },
  },
  //#endregion
}
