#!/usr/bin/env node

/**
 * Simple test runner for ActionSync
 * Alternative to Jest for basic testing scenarios
 */

import ActionSync from '../actionsync.js';

// Simple test framework
let testCount = 0;
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  testCount++;
  console.log(`\n🧪 Running: ${name}`);
  
  try {
    fn();
    passCount++;
    console.log(`✅ PASS: ${name}`);
  } catch (error) {
    failCount++;
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Error: ${error.message}`);
  }
}

function expect(actual) {
  return {
    toBe: (expected) => {
      if (actual !== expected) {
        throw new Error(`Expected ${expected}, but got ${actual}`);
      }
    },
    toThrow: (expectedMessage) => {
      if (typeof actual !== 'function') {
        throw new Error('Expected a function for toThrow matcher');
      }
      try {
        actual();
        throw new Error('Expected function to throw, but it did not');
      } catch (error) {
        if (expectedMessage && !error.message.includes(expectedMessage)) {
          throw new Error(`Expected error message to contain "${expectedMessage}", but got "${error.message}"`);
        }
      }
    }
  };
}

// Mock fetch globally
global.fetch = function(url, options) {
  // Default mock response
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({
      success: true,
      lastActionId: 'mock-server-id',
      actions: []
    })
  });
};

// Mock Chrome storage API
const mockStorageData = {};
global.chrome = {
  storage: {
    local: {
      get: function(keys, callback) {
        const result = {};
        if (Array.isArray(keys)) {
          keys.forEach(key => {
            if (mockStorageData[key]) {
              result[key] = mockStorageData[key];
            }
          });
        } else if (typeof keys === 'string') {
          if (mockStorageData[keys]) {
            result[keys] = mockStorageData[keys];
          }
        }
        setTimeout(() => callback(result), 0);
      },
      set: function(data, callback) {
        Object.assign(mockStorageData, data);
        if (callback) setTimeout(callback, 0);
      },
      remove: function(keys, callback) {
        if (Array.isArray(keys)) {
          keys.forEach(key => delete mockStorageData[key]);
        } else if (typeof keys === 'string') {
          delete mockStorageData[keys];
        }
        if (callback) setTimeout(callback, 0);
      }
    }
  },
  runtime: {
    lastError: null
  }
};

// Run tests
console.log('🚀 Starting ActionSync Tests\n');

test('ActionSync initializes correctly', () => {
  const actionSync = new ActionSync({
    serverUrl: 'https://test.com',
    deviceId: 'test-device',
    autoSync: false
  });
  
  expect(actionSync.deviceId).toBe('test-device');
  expect(actionSync.isSynced()).toBe(true);
  
  actionSync.destroy();
});

test('Actions dispatch and queue correctly', () => {
  const actionSync = new ActionSync({
    serverUrl: 'https://test.com',
    deviceId: 'test-device',
    autoSync: false
  });
  
  const actionId = actionSync.dispatch({ type: 'TEST_ACTION', data: 'test' });
  
  expect(typeof actionId).toBe('string');
  expect(actionSync.isSynced()).toBe(false);
  expect(actionSync.getStatus().queueLength).toBe(1);
  
  actionSync.destroy();
});

test('Queue clears after sync (no resending)', async () => {
  const actionSync = new ActionSync({
    serverUrl: 'https://test.com',
    deviceId: 'test-device', 
    autoSync: false
  });
  
  // Dispatch actions
  actionSync.dispatch({ type: 'ACTION_1' });
  actionSync.dispatch({ type: 'ACTION_2' });
  
  expect(actionSync.getStatus().queueLength).toBe(2);
  expect(actionSync.isSynced()).toBe(false);
  
  // Mock successful sync
  let fetchCallCount = 0;
  global.fetch = function(url, options) {
    fetchCallCount++;
    const body = JSON.parse(options.body);
    
    if (fetchCallCount === 1) {
      // First sync - should have 2 actions
      if (body.actions.length !== 2) {
        throw new Error(`Expected 2 actions in first sync, got ${body.actions.length}`);
      }
    } else if (fetchCallCount === 2) {
      // Second sync - should have 0 actions (no resending)
      if (body.actions.length !== 0) {
        throw new Error(`Expected 0 actions in second sync, got ${body.actions.length}`);
      }
    }
    
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        success: true,
        lastActionId: `mock-id-${fetchCallCount}`,
        actions: []
      })
    });
  };
  
  // First sync
  await actionSync.sync();
  expect(actionSync.getStatus().queueLength).toBe(0);
  expect(actionSync.isSynced()).toBe(true);
  
  // Second sync - should not resend actions
  await actionSync.sync();
  expect(actionSync.getStatus().queueLength).toBe(0);
  expect(actionSync.isSynced()).toBe(true);
  
  actionSync.destroy();
});

test('Export clears queue and allows re-export', () => {
  const actionSync = new ActionSync({
    serverUrl: 'https://test.com',
    deviceId: 'test-device',
    autoSync: false
  });
  
  actionSync.dispatch({ type: 'EXPORT_TEST' });
  expect(actionSync.getStatus().queueLength).toBe(1);
  
  const exportData = actionSync.export();
  expect(actionSync.getStatus().queueLength).toBe(0);
  expect(actionSync.getStatus().lastExportQueueLength).toBe(1);
  expect(actionSync.isSynced()).toBe(true);
  
  const reexportData = actionSync.reexportLast();
  expect(exportData).toBe(reexportData);
  
  actionSync.destroy();
});

test('Import returns payloads without affecting queue', () => {
  const actionSync = new ActionSync({
    serverUrl: 'https://test.com',
    deviceId: 'test-device',
    autoSync: false
  });
  
  const importData = {
    deviceId: 'other-device',
    timestamp: Date.now(),
    lastActionId: 'import-test',
    actions: [
      {
        actionId: 'import-1',
        timestamp: Date.now(),
        deviceId: 'other-device',
        payload: { type: 'IMPORTED_ACTION', data: 'test' }
      }
    ]
  };
  
  const payloads = actionSync.import(JSON.stringify(importData));
  
  expect(Array.isArray(payloads)).toBe(true);
  expect(payloads.length).toBe(1);
  expect(payloads[0].type).toBe('IMPORTED_ACTION');
  expect(actionSync.getStatus().queueLength).toBe(0); // Should not affect local queue
  
  actionSync.destroy();
});

test('Error handling', () => {
  const actionSync = new ActionSync({
    serverUrl: 'https://test.com',
    deviceId: 'test-device',
    autoSync: false
  });
  
  expect(() => actionSync.import('invalid json')).toThrow('Import failed');
  expect(() => actionSync.reexportLast()).toThrow('No previous export');
  
  actionSync.destroy();
});

test('Chrome storage persistence', async () => {
  const actionSync = new ActionSync({
    serverUrl: 'https://test.com',
    deviceId: 'test-persistence',
    autoSync: false
  });
  
  // Wait for initialization
  await new Promise(resolve => setTimeout(resolve, 50));
  
  // Dispatch actions
  actionSync.dispatch({ type: 'PERSIST_TEST_1' });
  actionSync.dispatch({ type: 'PERSIST_TEST_2' });
  
  // Wait for storage operations
  await new Promise(resolve => setTimeout(resolve, 20));
  
  // Verify actions are persisted
  const storageKey = `actionsync_test-persistence`;
  expect(mockStorageData[storageKey]).toBeTruthy();
  expect(mockStorageData[storageKey].actionQueue.length).toBe(2);
  expect(mockStorageData[storageKey].actionQueue[0].payload.type).toBe('PERSIST_TEST_1');
  
  actionSync.destroy();
});

// Print results
console.log(`\n📊 Test Results:`);
console.log(`   Total: ${testCount}`);
console.log(`   ✅ Passed: ${passCount}`);
console.log(`   ❌ Failed: ${failCount}`);

if (failCount === 0) {
  console.log(`\n🎉 All tests passed!`);
  process.exit(0);
} else {
  console.log(`\n💥 ${failCount} test(s) failed!`);
  process.exit(1);
} 