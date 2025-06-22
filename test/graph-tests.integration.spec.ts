import { lightBridgeGraphQLService } from '@bobanetwork/graphql-utils'
import { expect } from './setup'

describe('Single Event fetches', function () {
  it('should fetch latest disbursements if only from to and deposit ID is set after db removal', async () => {
    const events = await lightBridgeGraphQLService.queryAssetReceivedEvent(
      11155111,
      28882,
      null,
      null,
      null,
      117
    )
    const ev = events.find((e) => e.depositId === '117')
    expect(ev.__typename).to.eq('AssetReceived')
  })

  it('should fetch latest disbursements if blocks are added', async () => {
    const events = await lightBridgeGraphQLService.queryAssetReceivedEvent(
      11155111,
      28882,
      null,
      0,
      null,
      117
    )
    const ev = events.find((e) => e.depositId === '117')
    expect(ev.__typename).to.eq('AssetReceived')
  })
})
