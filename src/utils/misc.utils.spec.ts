import chai, { expect } from 'chai'
import chaiAsPromised from 'chai-as-promised'
chai.use(chaiAsPromised)
import { hasRecentAirdrop } from './misc.utils'
import { lightBridgeGraphQLService } from '@bobanetwork/graphql-utils'

describe('hasRecentAirdrop', () => {
  describe('basic functionality', () => {
    it('should return false when no recent airdrops exist (placeholder implementation)', async () => {
      const result = await hasRecentAirdrop(
        '0x1234567890123456789012345678901234567890',
        288,
        86400
      )

      expect(result).to.be.false
    })
    it('should handle different wallet addresses', async () => {
      const walletAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'

      const result = await hasRecentAirdrop(walletAddress, 56288, 3600)

      expect(result).to.be.false
    })
    it('should handle different chain IDs', async () => {
      const result = await hasRecentAirdrop(
        '0x1234567890123456789012345678901234567890',
        28882, // testnet
        86400
      )

      expect(result).to.be.false
    })
    it('should handle different cooldown periods', async () => {
      const result1 = await hasRecentAirdrop(
        '0x1234567890123456789012345678901234567890',
        288,
        3600 // 1 hour
      )

      const result2 = await hasRecentAirdrop(
        '0x1234567890123456789012345678901234567890',
        288,
        172800 // 48 hours
      )

      expect(result1).to.be.false
      expect(result2).to.be.false
    })
  })

  describe('parameter validation', () => {
    it('should handle zero addresses', async () => {
      const result = await hasRecentAirdrop(
        '0x0000000000000000000000000000000000000000',
        288,
        86400
      )

      expect(result).to.be.false
    })
    it('should handle empty string addresses gracefully', async () => {
      const result = await hasRecentAirdrop('', 288, 86400)

      expect(result).to.be.false
    })
    it('should handle zero cooldown period', async () => {
      const result = await hasRecentAirdrop(
        '0x1234567890123456789012345678901234567890',
        288,
        0
      )

      expect(result).to.be.false
    })
    it('should handle negative cooldown period', async () => {
      const result = await hasRecentAirdrop(
        '0x1234567890123456789012345678901234567890',
        288,
        -3600
      )

      expect(result).to.be.false
    })
    it('should use default cooldown when not provided', async () => {
      const result = await hasRecentAirdrop(
        '0x1234567890123456789012345678901234567890',
        288
        // No cooldown parameter provided, should use default 86400
      )

      expect(result).to.be.false
    })
  })

  describe('GraphQL integration with mocked responses', () => {
    let originalConductQuery: any

    beforeEach(() => {
      originalConductQuery = lightBridgeGraphQLService.conductQuery
    })

    afterEach(() => {
      lightBridgeGraphQLService.conductQuery = originalConductQuery
    })

    it('should return true when recent disbursements exist within cooldown period', async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000)
      const recentTimestamp = currentTimestamp - 3600 // 1 hour ago
      const mockResponse = {
        data: {
          disbursementSuccesses: [
            {
              id: '0x123',
              to: '0x1234567890123456789012345678901234567890',
              timestamp_: recentTimestamp.toString(),
            },
          ],
        },
        loading: false,
        networkStatus: 7,
      }

      lightBridgeGraphQLService.conductQuery = async () => mockResponse

      const result = await hasRecentAirdrop(
        '0x1234567890123456789012345678901234567890',
        288,
        86400
      )

      expect(result).to.be.true
    })
    it('should return false when disbursements exist but are outside cooldown period', async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000)
      const oldTimestamp = currentTimestamp - 172800

      const mockResponse = {
        data: {
          disbursementSuccesses: [
            {
              id: '0x456',
              to: '0x1234567890123456789012345678901234567890',
              timestamp_: oldTimestamp.toString(),
            },
          ],
        },
        loading: false,
        networkStatus: 7,
      }

      lightBridgeGraphQLService.conductQuery = async () => mockResponse

      const result = await hasRecentAirdrop(
        '0x1234567890123456789012345678901234567890',
        288,
        86400
      )

      expect(result).to.be.false
    })
    it('should return false when no disbursements exist', async () => {
      const mockResponse = {
        data: {
          disbursementSuccesses: [],
        },
        loading: false,
        networkStatus: 7,
      }

      lightBridgeGraphQLService.conductQuery = async () => mockResponse

      const result = await hasRecentAirdrop(
        '0x1234567890123456789012345678901234567890',
        288,
        86400
      )

      expect(result).to.be.false
    })
    it('should return false when GraphQL query fails', async () => {
      lightBridgeGraphQLService.conductQuery = async () => {
        throw new Error('GraphQL query failed')
      }

      const result = await hasRecentAirdrop(
        '0x1234567890123456789012345678901234567890',
        288,
        86400
      )

      expect(result).to.be.false
    })
    it('should handle mixed recent and old disbursements correctly', async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000)
      const recentTimestamp = currentTimestamp - 1800
      const oldTimestamp = currentTimestamp - 172800

      const mockResponse = {
        data: {
          disbursementSuccesses: [
            {
              id: '0x789',
              to: '0x1234567890123456789012345678901234567890',
              timestamp_: recentTimestamp.toString(),
            },
            {
              id: '0xabc',
              to: '0x1234567890123456789012345678901234567890',
              timestamp_: oldTimestamp.toString(),
            },
          ],
        },
        loading: false,
        networkStatus: 7,
      }

      lightBridgeGraphQLService.conductQuery = async () => mockResponse

      const result = await hasRecentAirdrop(
        '0x1234567890123456789012345678901234567890',
        288,
        86400
      )
      expect(result).to.be.true
    })
  })
})
