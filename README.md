# Light Bridge

This service monitors the on-chain events and release funds when a new deposit is found.

## Run hardhat scripts
Example: `npx hardhat run ./deploy/transfer-ownership.ts --network boba_goerli`

## Configuration

All configuration is done via environment variables. See all variables at [.env.example](.env.example); copy into a `.env` file before running.

|                                         | Description                                        | Default         |
|-----------------------------------------|----------------------------------------------------|-----------------|
| RPC_URL                                 | The endpoint of Layer 2                            |                 |
| LIGHTBRIDGE_REJECT_UNAUTHORIZED         | Allows self-signed certificates if false (TypeORM) | true            |
| LIGHTBRIDGE_DISBURSER_KEY               | The pk of disburser                                |                 |
| LIGHTBRIDGE_POLLING_INTERVAL            | The polling interval of fetching events            | 60s             |
| LIGHTBRIDGE_BLOCK_RANGE_PER_POLLING     | The blcock range of each polling                   | 1000            |
| LIGHTBRIDGE_POSTGRES_CONNECT_TIMEOUT_MS | DB connect timeout in ms                           | Typeorm default |
| LIGHTBRIDGE_POSTGRES_PASSWORD           | The database password                              | abcdef          |
| LIGHTBRIDGE_POSTGRES_DB_HOST            | The database host                                  | LIGHTBRIDGE_db  |
| LIGHTBRIDGE_POSTGRES_DB                 | The database name                                  | postgres        |
| LIGHTBRIDGE_POSTGRES_PORT               | The database port                                  | 5432            |
| LIGHTBRIDGE_POSTGRES_USER               | The database user                                  | postgres        |

## Building & Running

1. Make sure dependencies are installed - run `yarn` in the base directory
2. Build `yarn build`
3. Run `yarn start`

## Postgresql

Connect to Postgres on CLI:
`psql --username postgres -d postgres --password`


## Deployments

Contract audited.

---

## Testnet deployments

### Sepolia (L1)
- LightBridge deployed to: `0x6550b0B7e3D2dD0E0382E0638B0f56F614921CA5`
- Proxy__LightBridge deployed to: `0xaeE12b8D99BBff7ED47866DF868CF5b4b3F73ffF`

### Goerli (L1)
- LightBridge deployed to: `0xB93d9748808A5cC7dC6b61b31F15b87F50BfcAd0`
- Proxy__LightBridge deployed to: `0x84b22166366a6f7E0cD0c3ce9998f2913Bf17A13`

### BNB Testnet (L1)
- LightBridge deployed to: `0xD151c8F0dc69618e6180a2dC74B05cCE3E08e0aC`
- Proxy__LightBridge deployed to: `0x7f6a32bCaA70c65E08F2f221737612F6fC18347A`

### Boba Sepolia
- LightBridge deployed to: `0x3f7Da9C51138E0475aA26E80677d27A568cFD6b9`
- Proxy__LightBridge deployed to: `0x2dE73Bd1660Fbf4D521a52Ec2a91CCc106113801`

### Boba Goerli
- LightBridge deployed to: `0x95ec63aE2573bD5e70C223E075D9483573968699`
- Proxy__LightBridge deployed to: `0xB43EE846Aa266228FeABaD1191D6cB2eD9808894`

### Boba BNB Testnet
- LightBridge deployed to: `0x46FA6144C61d2bb9aCDc3Ca90C8673dd9B6caEB2`
- Proxy__LightBridge deployed to: `0xf4d179d3a083Fa3Eede935FaF4C679D32d514186`

### Arbitrum Goerli
- LightBridge deployed to: `0x81F27a114A25ac1c6186fC36888B1b120a46a650`
- Proxy__LightBridge deployed to: `0x7063f59e1Db3e505D844d11A71C78F92D39E5963`

### Optimism Goerli
- LightBridge deployed to: `0x885bfeC3D89755d2bCc1e73b6EeEEae94D54eBE4`
- Proxy__LightBridge deployed to: `0xC226F132A686A08018431C913d87693396246024`


---

## User flow / Dev flow:
![TeleportationFlow](https://github.com/bobanetwork/boba/assets/28724551/1c5fceb8-126d-42d1-92b4-59ec5ed9ad71)


---

## Contract params
This section describes how whitelisted routes between networks can be configured. By default no asset can be bridged, not even the native asset - all need to be explicitly whitelisted.

Asset support is configured on-chain on the LightBridge contract via
`function addSupportedToken(address _token, uint32 _toChainId, uint256 _minDepositAmount, uint256 _maxDepositAmount, uint256 _maxTransferAmountPerDay)`.

### Indicate support
Support for an asset can be shut down and re-activated at any time (yes|no value).

### Minimum Deposit Amount
The minimum amount that needs to be deposited in order to be bridged. The value refers to the asset to be bridged (e.g. ETH or BOBA tokens) and will revert for transactions that do not exceed this threshold (>=).

### Maximum Deposit Amount
The maximum amount that can be deposited within one single bridge operation. The value refers to the asset that is being bridged and will revert for transactions that exceed this value.

### Maximum Amount Per Day
The maximum amount per day limits how many units of the asset to be bridged can be moved to the corresponding network per day.

---

## AWS KMS
You will need a disburser key managed through KMS with the following configuration: 

- Key type: `asymmetric`
- Usage: `Signing/verifying`
- Specification: `ECC_SECG_P256K1`

Advanced Options:
- Origin: `KMS`
- Regionality: `Multi Region Key`
