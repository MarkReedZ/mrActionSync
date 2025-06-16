/**
 * ActionSync Server Tests
 */
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import app from '../server.js';

describe('ActionSync Server', () => {
  beforeEach(async () => {
    // Clear server data before each test
    await request(app).post('/clear');
  });

  describe('Health and Stats Endpoints', () => {
    test('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        timestamp: expect.any(String),
        stats: {
          totalActions: 0,
          connectedDevices: 0,
          uptime: expect.any(Number)
        }
      });
    });

    test('should return server statistics', async () => {
      const response = await request(app)
        .get('/stats')
        .expect(200);

      expect(response.body).toMatchObject({
        totalActions: 0,
        devices: {},
        lastSync: {},
        recentActions: []
      });
    });

    test('should clear all data', async () => {
      // First add some data
      await request(app)
        .post('/sync')
        .send({
          deviceId: 'test-device',
          lastActionId: '0',
          actions: [
            {
              actionId: 'test-1',
              timestamp: Date.now(),
              deviceId: 'test-device',
              payload: { type: 'TEST_ACTION' }
            }
          ]
        });

      // Verify data exists
      const statsBeforeClear = await request(app).get('/stats');
      expect(statsBeforeClear.body.totalActions).toBe(1);

      // Clear data
      const clearResponse = await request(app)
        .post('/clear')
        .expect(200);

      expect(clearResponse.body).toMatchObject({
        success: true,
        message: 'All data cleared'
      });

      // Verify data is cleared
      const statsAfterClear = await request(app).get('/stats');
      expect(statsAfterClear.body.totalActions).toBe(0);
    });
  });

  describe('Sync Endpoint', () => {
    test('should handle sync request with actions', async () => {
      const testActions = [
        {
          actionId: 'action-1',
          timestamp: Date.now() - 1000,
          deviceId: 'device-1',
          payload: { type: 'BUTTON_CLICK', button: 'save' }
        },
        {
          actionId: 'action-2',
          timestamp: Date.now(),
          deviceId: 'device-1',
          payload: { type: 'TEXT_INPUT', field: 'username', value: 'test' }
        }
      ];

      const response = await request(app)
        .post('/sync')
        .send({
          deviceId: 'device-1',
          lastActionId: '0',
          actions: testActions
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        lastActionId: expect.any(String),
        actions: [],
        serverTimestamp: expect.any(Number)
      });

      // Verify actions were stored
      const stats = await request(app).get('/stats');
      expect(stats.body.totalActions).toBe(2);
      expect(stats.body.devices['device-1']).toBe(2);
    });

    test('should synchronize actions between devices', async () => {
      // Device 1 sends actions
      const device1Actions = [
        {
          actionId: 'device1-action-1',
          timestamp: Date.now() - 1000,
          deviceId: 'device-1',
          payload: { type: 'DEVICE1_ACTION', data: 'test1' }
        }
      ];

      const device1Response = await request(app)
        .post('/sync')
        .send({
          deviceId: 'device-1',
          lastActionId: '0',
          actions: device1Actions
        })
        .expect(200);

      expect(device1Response.body.actions).toHaveLength(0); // No other device actions yet

      // Device 2 sends actions and should receive device 1's actions
      const device2Actions = [
        {
          actionId: 'device2-action-1',
          timestamp: Date.now(),
          deviceId: 'device-2',
          payload: { type: 'DEVICE2_ACTION', data: 'test2' }
        }
      ];

      const device2Response = await request(app)
        .post('/sync')
        .send({
          deviceId: 'device-2',
          lastActionId: '0',
          actions: device2Actions
        })
        .expect(200);

      expect(device2Response.body.actions).toHaveLength(1);
      expect(device2Response.body.actions[0]).toMatchObject({
        actionId: 'device1-action-1',
        deviceId: 'device-1',
        payload: { type: 'DEVICE1_ACTION', data: 'test1' }
      });

      // Device 1 syncs again and should receive device 2's actions
      const device1SecondSync = await request(app)
        .post('/sync')
        .send({
          deviceId: 'device-1',
          lastActionId: device1Response.body.lastActionId,
          actions: []
        })
        .expect(200);

      expect(device1SecondSync.body.actions).toHaveLength(1);
      expect(device1SecondSync.body.actions[0]).toMatchObject({
        actionId: 'device2-action-1',
        deviceId: 'device-2',
        payload: { type: 'DEVICE2_ACTION', data: 'test2' }
      });
    });

    test('should not return device own actions', async () => {
      // Device sends actions
      const response1 = await request(app)
        .post('/sync')
        .send({
          deviceId: 'device-1',
          lastActionId: '0',
          actions: [
            {
              actionId: 'own-action',
              timestamp: Date.now(),
              deviceId: 'device-1',
              payload: { type: 'OWN_ACTION' }
            }
          ]
        })
        .expect(200);

      // Same device syncs again - should not receive its own actions
      const response2 = await request(app)
        .post('/sync')
        .send({
          deviceId: 'device-1',
          lastActionId: response1.body.lastActionId,
          actions: []
        })
        .expect(200);

      expect(response2.body.actions).toHaveLength(0);
    });

    test('should handle incremental sync with lastActionId', async () => {
      // Send initial actions
      const response1 = await request(app)
        .post('/sync')
        .send({
          deviceId: 'device-1',
          lastActionId: '0',
          actions: [
            {
              actionId: 'action-1',
              timestamp: Date.now() - 2000,
              deviceId: 'device-1',
              payload: { type: 'ACTION_1' }
            }
          ]
        });

      const response2 = await request(app)
        .post('/sync')
        .send({
          deviceId: 'device-1',
          lastActionId: response1.body.lastActionId,
          actions: [
            {
              actionId: 'action-2',
              timestamp: Date.now() - 1000,
              deviceId: 'device-1',
              payload: { type: 'ACTION_2' }
            }
          ]
        });

      // Device 2 syncs with no lastActionId - should get all actions
      const device2Response1 = await request(app)
        .post('/sync')
        .send({
          deviceId: 'device-2',
          lastActionId: '0',
          actions: []
        });

      expect(device2Response1.body.actions).toHaveLength(2);

      // Device 2 syncs again with lastActionId - should get no new actions
      const device2Response2 = await request(app)
        .post('/sync')
        .send({
          deviceId: 'device-2',
          lastActionId: device2Response1.body.lastActionId,
          actions: []
        });

      expect(device2Response2.body.actions).toHaveLength(0);
    });

    test('should validate sync request parameters', async () => {
      // Missing deviceId
      await request(app)
        .post('/sync')
        .send({
          lastActionId: '0',
          actions: []
        })
        .expect(400);

      // Invalid actions (not array)
      await request(app)
        .post('/sync')
        .send({
          deviceId: 'test-device',
          lastActionId: '0',
          actions: 'invalid'
        })
        .expect(400);
    });
  });

  describe('Device Actions Endpoint', () => {
    test('should return actions for specific device', async () => {
      // Add actions for device
      await request(app)
        .post('/sync')
        .send({
          deviceId: 'test-device',
          lastActionId: '0',
          actions: [
            {
              actionId: 'device-action-1',
              timestamp: Date.now(),
              deviceId: 'test-device',
              payload: { type: 'DEVICE_ACTION' }
            }
          ]
        });

      const response = await request(app)
        .get('/device/test-device/actions')
        .expect(200);

      expect(response.body).toMatchObject({
        deviceId: 'test-device',
        count: 1,
        actions: expect.arrayContaining([
          expect.objectContaining({
            actionId: 'device-action-1',
            payload: { type: 'DEVICE_ACTION' }
          })
        ])
      });
    });

    test('should return empty array for device with no actions', async () => {
      const response = await request(app)
        .get('/device/nonexistent-device/actions')
        .expect(200);

      expect(response.body).toMatchObject({
        deviceId: 'nonexistent-device',
        count: 0,
        actions: []
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle 404 for unknown endpoints', async () => {
      await request(app)
        .get('/unknown-endpoint')
        .expect(404);
    });

    test('should handle malformed JSON', async () => {
      await request(app)
        .post('/sync')
        .send('invalid json')
        .expect(400);
    });
  });
}); 