# mrActionSync

Simple event-sourced sync engine for offline-first web applications. ActionSync enables seamless synchronization of user actions across multiple devices by maintaining a queue of actions with unique identifiers and timestamps.

## Features

- **Event-Sourced Sync**: Actions are queued locally and synced across devices
- **Offline-First**: Works without network connectivity, syncs when available
- **Manual Export/Import**: Share actions via JSON or clipboard
- **Remote Server Sync**: Automatic synchronization with remote server
- **Deterministic Ordering**: Timestamp-based action ordering ensures consistency
- **Unique Action IDs**: 64-bit IDs with embedded timestamps for natural ordering

## Installation

```bash
npm install
```

## Basic Usage

```javascript
import ActionSync from './actionsync.js';

// Initialize with configuration
const actionSync = new ActionSync({
  serverUrl: 'http://localhost:3000',  // Optional: for remote sync
  deviceId: 'my-device-1',            // Optional: auto-generated if not provided
  autoSync: true,                     // Optional: enables automatic syncing
  debug: true                         // Optional: enables debug logging
});

// Dispatch actions
const actionId = actionSync.dispatch({
  type: 'BUTTON_CLICK',
  element: 'save-button',
  coordinates: { x: 150, y: 75 }
});

// Check if all actions are synced
console.log('Is synced:', actionSync.isSynced());

// Get current status
console.log('Status:', actionSync.getStatus());
```

## Manual Export/Import

### Export Actions

```javascript
// Export all actions as JSON string
const exportData = actionSync.export();
console.log('Export data:', exportData);

// Export to clipboard (requires HTTPS and user interaction)
try {
  const success = await actionSync.exportToClipboard();
  if (success) {
    console.log('Actions copied to clipboard');
  }
} catch (error) {
  console.error('Clipboard export failed:', error.message);
}
```

### Import Actions

```javascript
// Import from JSON string
const importResult = actionSync.import(exportData);
console.log(`Imported ${importResult.importedCount} actions`);

// Import from clipboard
try {
  const result = await actionSync.importFromClipboard();
  console.log(`Imported ${result.importedCount} actions from clipboard`);
} catch (error) {
  console.error('Clipboard import failed:', error.message);
}
```

### Manual Sync Workflow

1. **Device 1**: Export actions using `export()` or `exportToClipboard()`
2. **Transfer**: Share the JSON data via email, file, chat, etc.
3. **Device 2**: Import actions using `import(jsonString)` or `importFromClipboard()`
4. **Apply**: Actions are automatically merged and applied in timestamp order

## Remote Server Setup

### Starting the Server

```bash
# Start the development server
npm run server

# Or start with auto-restart on changes
npm run server:dev

# Server runs on http://localhost:3000 by default
# Set PORT environment variable to change port
PORT=8080 npm run server
```

### Server Endpoints

- `GET /health` - Health check and server stats
- `GET /stats` - Detailed statistics about actions and devices
- `POST /sync` - Main synchronization endpoint
- `POST /clear` - Clear all data (for testing)
- `GET /device/:deviceId/actions` - Get actions for specific device

### Using Remote Sync

```javascript
// Initialize with server URL
const actionSync = new ActionSync({
  serverUrl: 'http://localhost:3000',
  deviceId: 'my-device',
  autoSync: true  // Automatically sync every 30 seconds
});

// Dispatch actions - they'll be automatically synced
actionSync.dispatch({ type: 'USER_ACTION', data: 'example' });

// Manual sync
try {
  const result = await actionSync.sync();
  console.log('Sync successful:', result.success);
  console.log('Remote actions received:', result.remotePayloads);
} catch (error) {
  console.error('Sync failed:', error.message);
}
```

### Production Deployment

The server is a simple Express.js application that can be deployed to any Node.js hosting platform:

```bash
# For production
NODE_ENV=production node server.js

# Or use a process manager
pm2 start server.js --name "actionsync-server"
```

**Note**: The included server stores data in memory and is intended for development/testing. For production, you should implement persistent storage (database, file system, etc.).

## Running Tests

### Jest Tests (Recommended)

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Simple Test Runner

```bash
# Run the simple test runner
npm run test:simple

# This runs tests/run-tests.js which doesn't require Jest
```

### Test Structure

- `tests/actionsync.test.js` - Main ActionSync functionality tests
- `tests/server.test.js` - Server endpoint tests  
- `tests/server-simple.test.js` - Simple server tests
- `tests/run-tests.js` - Alternative test runner (no Jest dependency)
- `tests/setup.js` - Test environment setup

### Example Test Run

```bash
$ npm run test:simple

🚀 Starting ActionSync Tests

🧪 Running: ActionSync initializes correctly
✅ PASS: ActionSync initializes correctly

🧪 Running: Actions dispatch and queue correctly  
✅ PASS: Actions dispatch and queue correctly

🧪 Running: Queue clears after sync (no resending)
✅ PASS: Queue clears after sync (no resending)

Test Results: 15/15 passed ✅
```

## API Reference

### Constructor Options

```javascript
new ActionSync({
  serverUrl: 'http://localhost:3000',  // Server URL for remote sync
  deviceId: 'my-device',              // Unique device identifier
  autoSync: true,                     // Enable automatic syncing
  syncInterval: 30000,                // Auto-sync interval (ms)
  maxQueueSize: 1000,                 // Maximum actions in queue
  retryAttempts: 3,                   // Sync retry attempts
  debug: false,                       // Enable debug logging
  enablePersistence: true             // Enable local storage persistence
})
```

### Main Methods

- `dispatch(action, filterKeys)` - Add action to queue
- `sync()` - Sync with remote server  
- `export()` - Export actions as JSON
- `import(jsonString)` - Import actions from JSON
- `exportToClipboard()` - Export to system clipboard
- `importFromClipboard()` - Import from system clipboard
- `getStatus()` - Get current sync status
- `isSynced()` - Check if all actions are synced
- `clearQueue()` - Clear pending actions
- `destroy()` - Cleanup and stop auto-sync

## Examples

See `example.js` for comprehensive usage examples:

```bash
npm run example
```

## License

MIT
