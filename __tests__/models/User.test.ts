import mongoose from 'mongoose';
import User from '../../models/User';

describe('User Model - Stellar Fields', () => {
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chainmove-test');
    await User.init();
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  afterEach(async () => {
    await User.deleteMany({});
  });

  describe('User with Stellar public key', () => {
    it('should create a user with Stellar public key', async () => {
      const userData = {
        name: 'John Doe',
        email: 'john@example.com',
        role: 'investor',
        stellarPublicKey: 'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B',
        stellarAccountType: 'external_wallet',
        stellarLinkedAt: new Date(),
      };

      const user = await User.create(userData);

      expect(user.stellarPublicKey).toBe(userData.stellarPublicKey);
      expect(user.stellarAccountType).toBe('external_wallet');
      expect(user.stellarLinkedAt).toBeDefined();
      expect(user.name).toBe(userData.name);
    });

    it('should allow stellarPublicKey to be unique and sparse', async () => {
      const publicKey = 'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B';
      
      const user1 = await User.create({
        name: 'User 1',
        email: 'user1@example.com',
        role: 'investor',
        stellarPublicKey: publicKey,
      });

      expect(user1.stellarPublicKey).toBe(publicKey);

      // Try to create another user with same public key - should fail
      await expect(
        User.create({
          name: 'User 2',
          email: 'user2@example.com',
          role: 'investor',
          stellarPublicKey: publicKey,
        })
      ).rejects.toThrow();
    });

    it('should allow null stellarPublicKey for multiple users', async () => {
      const user1 = await User.create({
        name: 'User 1',
        email: 'user1@example.com',
        role: 'investor',
      });

      const user2 = await User.create({
        name: 'User 2',
        email: 'user2@example.com',
        role: 'investor',
      });

      expect(user1.stellarPublicKey).toBeUndefined();
      expect(user2.stellarPublicKey).toBeUndefined();
    });
  });

  describe('User without Stellar public key', () => {
    it('should create a user without Stellar data', async () => {
      const userData = {
        name: 'Jane Doe',
        email: 'jane@example.com',
        role: 'driver',
      };

      const user = await User.create(userData);

      expect(user.stellarPublicKey).toBeUndefined();
      expect(user.stellarAccountType).toBe('unknown');
      expect(user.stellarLinkedAt).toBeNull();
      expect(user.stellarLastSyncedAt).toBeNull();
    });

    it('should maintain backward compatibility with existing Privy and wallet fields', async () => {
      const userData = {
        name: 'Test User',
        email: 'test@example.com',
        role: 'investor',
        privyUserId: 'privy_123',
        walletAddress: '0x123456',
      };

      const user = await User.create(userData);

      expect(user.privyUserId).toBe('privy_123');
      expect(user.walletAddress).toBe('0x123456');
      expect(user.stellarPublicKey).toBeUndefined();
    });
  });

  describe('Account type validation', () => {
    it('should accept valid account types', async () => {
      const types = ['external_wallet', 'platform_managed', 'unknown'];

      for (const type of types) {
        const user = await User.create({
          name: `User ${type}`,
          email: `user-${type}@example.com`,
          role: 'investor',
          stellarAccountType: type as any,
        });

        expect(user.stellarAccountType).toBe(type);
      }
    });

    it('should reject invalid account types', async () => {
      await expect(
        User.create({
          name: 'Invalid Type User',
          email: 'invalid@example.com',
          role: 'investor',
          stellarAccountType: 'invalid_type' as any,
        })
      ).rejects.toThrow();
    });

    it('should default to unknown account type', async () => {
      const user = await User.create({
        name: 'Default Type User',
        email: 'default@example.com',
        role: 'investor',
      });

      expect(user.stellarAccountType).toBe('unknown');
    });
  });

  describe('Stellar timestamps', () => {
    it('should set stellarLinkedAt when provided', async () => {
      const linkedAt = new Date('2024-01-15');
      const user = await User.create({
        name: 'Linked User',
        email: 'linked@example.com',
        role: 'investor',
        stellarPublicKey: 'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B',
        stellarLinkedAt: linkedAt,
      });

      expect(user.stellarLinkedAt).toEqual(linkedAt);
    });

    it('should set stellarLastSyncedAt when provided', async () => {
      const syncedAt = new Date('2024-01-16');
      const user = await User.create({
        name: 'Synced User',
        email: 'synced@example.com',
        role: 'investor',
        stellarPublicKey: 'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B',
        stellarLastSyncedAt: syncedAt,
      });

      expect(user.stellarLastSyncedAt).toEqual(syncedAt);
    });

    it('should have null timestamps by default', async () => {
      const user = await User.create({
        name: 'No Timestamp User',
        email: 'notimestamp@example.com',
        role: 'investor',
      });

      expect(user.stellarLinkedAt).toBeNull();
      expect(user.stellarLastSyncedAt).toBeNull();
    });
  });

  describe('Schema validation and field coexistence', () => {
    it('should allow all Stellar fields together', async () => {
      const user = await User.create({
        name: 'Full Stellar User',
        email: 'full@example.com',
        role: 'investor',
        stellarPublicKey: 'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B',
        stellarAccountType: 'platform_managed',
        stellarLinkedAt: new Date('2024-01-15'),
        stellarLastSyncedAt: new Date('2024-01-16'),
      });

      expect(user.stellarPublicKey).toBeDefined();
      expect(user.stellarAccountType).toBe('platform_managed');
      expect(user.stellarLinkedAt).toBeDefined();
      expect(user.stellarLastSyncedAt).toBeDefined();
    });

    it('should preserve existing KYC fields with Stellar data', async () => {
      const user = await User.create({
        name: 'KYC Stellar User',
        email: 'kyc@example.com',
        role: 'investor',
        kycStatus: 'approved_stage1',
        stellarPublicKey: 'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B',
      });

      expect(user.kycStatus).toBe('approved_stage1');
      expect(user.stellarPublicKey).toBe('GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B');
    });
  });
});
