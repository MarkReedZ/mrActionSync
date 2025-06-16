/**
 * Jest setup file for ActionSync tests
 */
import { jest } from '@jest/globals';
import { TextEncoder, TextDecoder } from 'util';

// Add TextEncoder and TextDecoder polyfills for Node.js
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock fetch globally
global.fetch = jest.fn();

// Mock navigator.clipboard for clipboard tests
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: jest.fn(() => Promise.resolve()),
    readText: jest.fn(() => Promise.resolve(''))
  },
  writable: true
});

// Mock Chrome storage API
const mockStorageData = {};
global.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
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
        callback(result);
      }),
      set: jest.fn((data, callback) => {
        Object.assign(mockStorageData, data);
        if (callback) callback();
      }),
      remove: jest.fn((keys, callback) => {
        if (Array.isArray(keys)) {
          keys.forEach(key => delete mockStorageData[key]);
        } else if (typeof keys === 'string') {
          delete mockStorageData[keys];
        }
        if (callback) callback();
      }),
      clear: jest.fn((callback) => {
        Object.keys(mockStorageData).forEach(key => delete mockStorageData[key]);
        if (callback) callback();
      })
    }
  },
  runtime: {
    lastError: null
  }
};

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  
  // Reset fetch mock to default behavior only if it has Jest mock methods
  if (global.fetch && typeof global.fetch.mockReset === 'function') {
    global.fetch.mockReset();
    global.fetch.mockResolvedValue(createMockResponse({
      success: true,
      lastActionId: 'default-mock-id',
      actions: []
    }));
  }
  
  // Reset clipboard mocks
  if (navigator.clipboard.writeText.mockReset) {
    navigator.clipboard.writeText.mockReset();
  }
  if (navigator.clipboard.readText.mockReset) {
    navigator.clipboard.readText.mockReset();
  }
  
  // Clear mock storage data
  Object.keys(mockStorageData).forEach(key => delete mockStorageData[key]);
  
  // Reset Chrome storage mocks
  chrome.storage.local.get.mockClear();
  chrome.storage.local.set.mockClear();
  chrome.storage.local.remove.mockClear();
  chrome.storage.local.clear.mockClear();
  chrome.runtime.lastError = null;
});

// Utility function to create mock server responses
global.createMockResponse = (data, status = 200) => {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data))
  });
};

// Utility function to simulate network delay
global.delay = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms)); 