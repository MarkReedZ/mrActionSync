import ActionSync from './actionsync.js';

// Example usage of ActionSync module
console.log('ActionSync Example Usage\n========================\n');

// Initialize ActionSync with configuration
const actionSync = new ActionSync({
  serverUrl: 'https://api.example.com',  // Replace with your server URL
  deviceId: 'example-device-1',
  debug: true,
  autoSync: false  // Disable auto-sync for this example
});

// Example 1: Basic action dispatching
console.log('1. Dispatching actions...');
const actionId1 = actionSync.dispatch({
  type: 'BUTTON_CLICK',
  element: 'save-button',
  coordinates: { x: 150, y: 75 }
});

const actionId2 = actionSync.dispatch({
  type: 'TEXT_INPUT',
  field: 'username',
  value: 'john_doe',
  timestamp: Date.now()
});

const actionId3 = actionSync.dispatch({
  type: 'FORM_SUBMIT',
  formId: 'login-form',
  fields: {
    username: 'john_doe',
    remember: true
  }
});

console.log(`Generated action IDs: ${actionId1}, ${actionId2}, ${actionId3}\n`);

// Example 2: Check status
console.log('2. Current status:');
console.log(actionSync.getStatus());
console.log();

// Example 3: Export actions
console.log('3. Exporting actions...');
const exportedData = actionSync.export();
console.log('Exported data (first 200 chars):', exportedData.substring(0, 200) + '...\n');

// Example 4: Import actions (simulating data from another device)
console.log('4. Importing actions from another device...');
const simulatedRemoteData = {
  deviceId: 'remote-device-2',
  timestamp: Date.now() - 5000,
  actions: [
    {
      actionId: '000001234567890abcdef12345678901',
      timestamp: Date.now() - 3000,
      deviceId: 'remote-device-2',
      payload: {
        type: 'SCROLL',
        direction: 'down',
        amount: 100
      }
    },
    {
      actionId: '000001234567890abcdef12345678902',
      timestamp: Date.now() - 2000,
      deviceId: 'remote-device-2',
      payload: {
        type: 'CLICK',
        element: 'menu-item',
        text: 'Profile'
      }
    }
  ],
  lastActionId: '000001234567890abcdef12345678902'
};

const importResult = actionSync.import(JSON.stringify(simulatedRemoteData));
console.log('Import result:', importResult);
console.log('Updated status:', actionSync.getStatus());
console.log();

// Example 5: Clipboard operations (requires HTTPS and user interaction)
async function clipboardExample() {
  console.log('5. Clipboard operations...');
  try {
    // Export to clipboard
    const exportSuccess = await actionSync.exportToClipboard();
    console.log('Export to clipboard success:', exportSuccess);

    // Note: In a real scenario, you'd copy from another device's clipboard
    // For demo purposes, we'll just try to import what we just exported
    const importFromClipboard = await actionSync.importFromClipboard();
    console.log('Import from clipboard result:', importFromClipboard);
  } catch (error) {
    console.log('Clipboard operations require HTTPS and user interaction:', error.message);
  }
  console.log();
}

// Example 6: Manual sync simulation
async function syncExample() {
  console.log('6. Sync simulation...');
  
  // Create another ActionSync instance to simulate a server response
  const mockServer = {
    actions: [
      {
        actionId: '000001234567890abcdef12345678903',
        timestamp: Date.now() - 1000,
        deviceId: 'server-device',
        payload: {
          type: 'NOTIFICATION',
          message: 'Welcome back!',
          priority: 'high'
        }
      }
    ],
    lastActionId: actionId3
  };

  // In a real implementation, this would make an HTTP request
  // Here we'll just simulate the merge process
  console.log('Simulating server response...');
  
  try {
    // For demonstration, we'll manually merge the mock server data
    const importResult = actionSync.import(JSON.stringify({
      deviceId: 'mock-server',
      timestamp: Date.now(),
      actions: mockServer.actions,
      lastActionId: mockServer.lastActionId
    }));
    
    console.log('Simulated sync result:', importResult);
  } catch (error) {
    console.log('Sync would fail without a real server:', error.message);
  }
  console.log();
}

// Example 7: Action ID analysis
console.log('7. Action ID analysis...');
console.log('Action IDs show timestamp ordering:');
actionSync.actionQueue.forEach((action, index) => {
  const timestamp = parseInt(action.actionId.substring(0, 8), 16) * 0x10000 + 
                   parseInt(action.actionId.substring(8, 12), 16);
  console.log(`  Action ${index + 1}: ID=${action.actionId}, Timestamp=${new Date(timestamp).toISOString()}`);
});
console.log();

// Run async examples
(async () => {
  await clipboardExample();
  await syncExample();
  
  // Example 8: Cleanup
  console.log('8. Cleanup...');
  actionSync.clearQueue();
  console.log('Final status:', actionSync.getStatus());
  
  actionSync.destroy();
  console.log('ActionSync instance destroyed.');
})();

// Example 9: Error handling
console.log('\n9. Error handling examples...');

try {
  actionSync.dispatch(null);
} catch (error) {
  console.log('Expected error for null action:', error.message);
}

try {
  actionSync.import('invalid json');
} catch (error) {
  console.log('Expected error for invalid JSON:', error.message);
}

console.log('\nExample completed!'); 