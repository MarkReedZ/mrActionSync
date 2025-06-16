#!/usr/bin/env node

/**
 * ActionSync Server
 * Simple Express.js server for handling ActionSync API calls
 * Keeps all data in memory for development/testing
 */

import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// In-memory storage
const storage = {
  actions: [], // All actions from all devices
  deviceLastSync: {}, // Track last sync time per device
  actionCounter: 0 // Global action counter for ordering
};

/**
 * Generate a server-side action ID
 * @returns {string} Unique server action ID
 */
function generateServerId() {
  return `server-${Date.now()}-${++storage.actionCounter}`;
}

/**
 * Store actions from a device
 * @param {Array} actions - Actions to store
 * @param {string} deviceId - Device that sent the actions
 */
function storeActions(actions, deviceId) {
  actions.forEach(action => {
    // Ensure each action has a server-assigned order
    const storedAction = {
      ...action,
      serverId: generateServerId(),
      receivedAt: Date.now(),
      sourceDevice: deviceId
    };
    
    storage.actions.push(storedAction);
  });
  
  // Update device last sync
  storage.deviceLastSync[deviceId] = Date.now();
  
  console.log(`Stored ${actions.length} actions from device ${deviceId}`);
}

/**
 * Get actions for a device since their last sync
 * @param {string} deviceId - Requesting device ID
 * @param {string} lastActionId - Last action ID the device has seen
 * @returns {Array} Actions to send to the device
 */
function getActionsForDevice(deviceId, lastActionId) {
  // Find the index of the last action the device has seen
  let startIndex = 0;
  
  if (lastActionId && lastActionId !== '0') {
    const lastActionIndex = storage.actions.findIndex(action => 
      action.actionId === lastActionId || action.serverId === lastActionId
    );
    
    if (lastActionIndex !== -1) {
      startIndex = lastActionIndex + 1;
    }
  }
  
  // Return actions from other devices that this device hasn't seen
  const actionsToSend = storage.actions
    .slice(startIndex)
    .filter(action => action.sourceDevice !== deviceId)
    .map(action => ({
      actionId: action.actionId,
      timestamp: action.timestamp,
      deviceId: action.deviceId,
      payload: action.payload
    }));
  
  console.log(`Sending ${actionsToSend.length} actions to device ${deviceId}`);
  return actionsToSend;
}

/**
 * Get the latest action ID (for use as lastActionId in responses)
 * @returns {string} Latest action ID
 */
function getLatestActionId() {
  if (storage.actions.length === 0) {
    return '0';
  }
  
  const latestAction = storage.actions[storage.actions.length - 1];
  return latestAction.serverId || latestAction.actionId || '0';
}

// Routes

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    stats: {
      totalActions: storage.actions.length,
      connectedDevices: Object.keys(storage.deviceLastSync).length,
      uptime: process.uptime()
    }
  });
});

/**
 * Get server statistics
 */
app.get('/stats', (req, res) => {
  const deviceStats = {};
  
  // Count actions per device
  storage.actions.forEach(action => {
    const deviceId = action.sourceDevice || action.deviceId;
    deviceStats[deviceId] = (deviceStats[deviceId] || 0) + 1;
  });
  
  res.json({
    totalActions: storage.actions.length,
    devices: deviceStats,
    lastSync: storage.deviceLastSync,
    recentActions: storage.actions.slice(-10).map(action => ({
      id: action.actionId,
      serverId: action.serverId,
      device: action.sourceDevice,
      type: action.payload?.type,
      timestamp: action.timestamp
    }))
  });
});

/**
 * Clear all data (for testing)
 */
app.post('/clear', (req, res) => {
  storage.actions = [];
  storage.deviceLastSync = {};
  storage.actionCounter = 0;
  
  console.log('All data cleared');
  res.json({ success: true, message: 'All data cleared' });
});

/**
 * Main sync endpoint
 * Handles action synchronization between devices
 */
app.post('/sync', (req, res) => {
  try {
    const { deviceId, lastActionId, actions } = req.body;
    
    // Validate request
    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: 'deviceId is required'
      });
    }
    
    if (!Array.isArray(actions)) {
      return res.status(400).json({
        success: false,
        error: 'actions must be an array'
      });
    }
    
    console.log(`Sync request from device ${deviceId}:`, {
      lastActionId,
      actionsCount: actions.length
    });
    
    // Store incoming actions
    if (actions.length > 0) {
      storeActions(actions, deviceId);
    }
    
    // Get actions to send back to this device
    const actionsToSend = getActionsForDevice(deviceId, lastActionId);
    
    // Prepare response
    const response = {
      success: true,
      lastActionId: getLatestActionId(),
      actions: actionsToSend,
      serverTimestamp: Date.now()
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * Get all actions for a specific device (debug endpoint)
 */
app.get('/device/:deviceId/actions', (req, res) => {
  const { deviceId } = req.params;
  
  const deviceActions = storage.actions
    .filter(action => action.sourceDevice === deviceId)
    .map(action => ({
      actionId: action.actionId,
      serverId: action.serverId,
      timestamp: action.timestamp,
      payload: action.payload,
      receivedAt: action.receivedAt
    }));
  
  res.json({
    deviceId,
    actions: deviceActions,
    count: deviceActions.length
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Only start server if this file is run directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  // Start server
  const server = app.listen(PORT, () => {
    console.log(`ActionSync Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Stats: http://localhost:${PORT}/stats`);
    console.log(`Sync endpoint: http://localhost:${PORT}/sync`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
}

export default app; 