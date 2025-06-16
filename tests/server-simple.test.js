/**
 * Simple ActionSync Server Tests
 * Using fetch instead of supertest to avoid ES modules issues
 */

import { jest, describe, test, expect, beforeAll, afterAll } from '@jest/globals';

const SERVER_URL = 'http://localhost:3000';

// Mock fetch for Node.js environment
let fetch;
beforeAll(async () => {
  const { default: nodeFetch } = await import('node-fetch');
  fetch = nodeFetch;
  global.fetch = fetch;
});

describe('ActionSync Server (Simple Tests)', () => {
  beforeAll(async () => {
    // Wait a bit for server to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Clear server data
    try {
      await fetch(`${SERVER_URL}/clear`, { method: 'POST' });
    } catch (error) {
      console.warn('Could not clear server data, server might not be running');
    }
  });

  test('should return health status', async () => {
    const response = await fetch(`${SERVER_URL}/health`);
    expect(response.ok).toBe(true);
    
    const health = await response.json();
    expect(health).toMatchObject({
      status: 'ok',
      timestamp: expect.any(String),
      stats: expect.objectContaining({
        totalActions: expect.any(Number),
        connectedDevices: expect.any(Number),
        uptime: expect.any(Number)
      })
    });
  });

  test('should handle sync with actions', async () => {
    const syncData = {
      deviceId: 'test-device-1',
      lastActionId: '0',
      actions: [
        {
          actionId: 'test-action-1',
          timestamp: Date.now(),
          deviceId: 'test-device-1',
          payload: { type: 'TEST_ACTION', data: 'test-data' }
        }
      ]
    };

    const response = await fetch(`${SERVER_URL}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(syncData)
    });

    expect(response.ok).toBe(true);
    
    const result = await response.json();
    expect(result).toMatchObject({
      success: true,
      lastActionId: expect.any(String),
      actions: expect.any(Array),
      serverTimestamp: expect.any(Number)
    });
  });

  test('should synchronize between devices', async () => {
    // Clear data first
    await fetch(`${SERVER_URL}/clear`, { method: 'POST' });

    // Device 1 sends action
    const device1Data = {
      deviceId: 'device-1',
      lastActionId: '0',
      actions: [
        {
          actionId: 'device1-action',
          timestamp: Date.now(),
          deviceId: 'device-1',
          payload: { type: 'DEVICE1_ACTION', message: 'Hello from device 1' }
        }
      ]
    };

    const device1Response = await fetch(`${SERVER_URL}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(device1Data)
    });

    expect(device1Response.ok).toBe(true);
    const device1Result = await device1Response.json();
    expect(device1Result.actions).toHaveLength(0); // No other devices yet

    // Device 2 syncs and should receive device 1's action
    const device2Data = {
      deviceId: 'device-2',
      lastActionId: '0',
      actions: []
    };

    const device2Response = await fetch(`${SERVER_URL}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(device2Data)
    });

    expect(device2Response.ok).toBe(true);
    const device2Result = await device2Response.json();
    expect(device2Result.actions).toHaveLength(1);
    expect(device2Result.actions[0]).toMatchObject({
      actionId: 'device1-action',
      deviceId: 'device-1',
      payload: { type: 'DEVICE1_ACTION', message: 'Hello from device 1' }
    });
  });

  test('should not return own actions to device', async () => {
    // Clear data first
    await fetch(`${SERVER_URL}/clear`, { method: 'POST' });

    // Device sends action
    const deviceData = {
      deviceId: 'device-self-test',
      lastActionId: '0',
      actions: [
        {
          actionId: 'self-action',
          timestamp: Date.now(),
          deviceId: 'device-self-test',
          payload: { type: 'SELF_ACTION' }
        }
      ]
    };

    const response1 = await fetch(`${SERVER_URL}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deviceData)
    });

    const result1 = await response1.json();

    // Same device syncs again - should not get its own action
    const deviceData2 = {
      deviceId: 'device-self-test',
      lastActionId: result1.lastActionId,
      actions: []
    };

    const response2 = await fetch(`${SERVER_URL}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deviceData2)
    });

    const result2 = await response2.json();
    expect(result2.actions).toHaveLength(0);
  });

  test('should return server stats', async () => {
    const response = await fetch(`${SERVER_URL}/stats`);
    expect(response.ok).toBe(true);
    
    const stats = await response.json();
    expect(stats).toMatchObject({
      totalActions: expect.any(Number),
      devices: expect.any(Object),
      lastSync: expect.any(Object),
      recentActions: expect.any(Array)
    });
  });

  test('should handle validation errors', async () => {
    // Test missing deviceId
    const invalidData = {
      lastActionId: '0',
      actions: []
    };

    const response = await fetch(`${SERVER_URL}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidData)
    });

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.success).toBe(false);
    expect(error.error).toContain('deviceId is required');
  });

  test('should handle 404 for unknown endpoints', async () => {
    const response = await fetch(`${SERVER_URL}/unknown-endpoint`);
    expect(response.status).toBe(404);
  });
}); 