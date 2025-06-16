#!/usr/bin/env node

/**
 * ActionSync Test Client
 * Demonstrates the ActionSync server functionality
 */

import ActionSync from './actionsync.js';

// Mock fetch for Node.js environment
global.fetch = async (url, options) => {
  const { default: fetch } = await import('node-fetch');
  return fetch(url, options);
};

// Mock Chrome storage for Node.js environment
global.chrome = {
  storage: {
    local: {
      get: (keys, callback) => callback({}),
      set: (data, callback) => callback && callback(),
      remove: (keys, callback) => callback && callback()
    }
  },
  runtime: { lastError: null }
};

async function demonstrateSync() {
  console.log('🚀 ActionSync Client Demo\n');

  const SERVER_URL = 'http://localhost:3000';

  // Create two devices to simulate multi-device sync
  const device1 = new ActionSync({
    serverUrl: SERVER_URL,
    deviceId: 'device-1',
    autoSync: false,
    debug: true,
    enablePersistence: false
  });

  const device2 = new ActionSync({
    serverUrl: SERVER_URL,
    deviceId: 'device-2', 
    autoSync: false,
    debug: true,
    enablePersistence: false
  });

  try {
    console.log('📱 Device 1 dispatching actions...');
    device1.dispatch({ type: 'BUTTON_CLICK', button: 'save', timestamp: Date.now() });
    device1.dispatch({ type: 'TEXT_INPUT', field: 'username', value: 'alice' });
    
    console.log('\n📱 Device 2 dispatching actions...');
    device2.dispatch({ type: 'BUTTON_CLICK', button: 'login', timestamp: Date.now() });
    device2.dispatch({ type: 'NAVIGATION', page: '/dashboard' });

    console.log('\n🔄 Device 1 syncing...');
    const device1SyncResult = await device1.sync();
    console.log('Device 1 received payloads:', device1SyncResult.remotePayloads);

    console.log('\n🔄 Device 2 syncing...');
    const device2SyncResult = await device2.sync();
    console.log('Device 2 received payloads:', device2SyncResult.remotePayloads);

    console.log('\n📊 Device 1 status:', device1.getStatus());
    console.log('📊 Device 2 status:', device2.getStatus());

    // Test another round after both are synced
    console.log('\n📱 Device 1 dispatching new action after sync...');
    device1.dispatch({ type: 'FILE_UPLOAD', filename: 'document.pdf' });

    console.log('\n🔄 Device 2 syncing again...');
    const device2SecondSync = await device2.sync();
    console.log('Device 2 received new payloads:', device2SecondSync.remotePayloads);

    // Get server stats
    console.log('\n📈 Fetching server stats...');
    const statsResponse = await fetch(`${SERVER_URL}/stats`);
    const stats = await statsResponse.json();
    console.log('Server stats:', JSON.stringify(stats, null, 2));

  } catch (error) {
    console.error('❌ Error during demo:', error.message);
  } finally {
    device1.destroy();
    device2.destroy();
  }
}

async function checkServerHealth() {
  const SERVER_URL = 'http://localhost:3000';
  
  try {
    console.log('🏥 Checking server health...');
    const response = await fetch(`${SERVER_URL}/health`);
    const health = await response.json();
    console.log('✅ Server is healthy:', health);
    return true;
  } catch (error) {
    console.log('❌ Server is not running:', error.message);
    console.log('💡 Start the server with: npm run server');
    return false;
  }
}

// Main execution
async function main() {
  const isServerHealthy = await checkServerHealth();
  
  if (isServerHealthy) {
    await demonstrateSync();
  }
}

main().catch(console.error); 