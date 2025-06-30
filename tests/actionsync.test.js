/**
 * ActionSync Tests
 */
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import ActionSync from '../actionsync.js';

describe('ActionSync', () => {
  let actionSync;
  const mockServerUrl = 'https://test-server.com/api';
  const mockDeviceId = 'test-device-123';

  beforeEach(() => {
    actionSync = new ActionSync({
      serverUrl: mockServerUrl,
      deviceId: mockDeviceId,
      autoSync: false, // Disable auto-sync for manual control in tests
      debug: false,
      retryAttempts: 1 // Reduce retries for faster tests
    });
  });

  afterEach(() => {
    if (actionSync) {
      actionSync.destroy();
    }
  });

  describe('Basic Functionality', () => {
    test('should initialize with correct properties', () => {
      expect(actionSync.deviceId).toBe(mockDeviceId);
      expect(actionSync.serverUrl).toBe(mockServerUrl);
      expect(actionSync.isSynced()).toBe(true); // Should be synced when queue is empty
    });

    test('should dispatch actions and mark as not synced', () => {
      const action = { type: 'TEST_ACTION', data: 'test' };
      
      const actionId = actionSync.dispatch(action);
      
      expect(actionId).toBeTruthy();
      expect(typeof actionId).toBe('string');
      expect(actionSync.isSynced()).toBe(false); // Should not be synced with queued actions
      expect(actionSync.getStatus().queueLength).toBe(1);
    });

    test('should generate unique action IDs', () => {
      const ids = new Set();
      
      for (let i = 0; i < 100; i++) {
        const actionId = actionSync.dispatch({ type: 'TEST', index: i });
        expect(ids.has(actionId)).toBe(false);
        ids.add(actionId);
      }
      
      expect(ids.size).toBe(100);
    });
  });

  describe('Sync Behavior - No Resending Already Sent Actions', () => {
    test('should not resend actions after successful sync', async () => {
      // Dispatch some actions
      actionSync.dispatch({ type: 'ACTION_1', data: 'first' });
      actionSync.dispatch({ type: 'ACTION_2', data: 'second' });
      actionSync.dispatch({ type: 'ACTION_3', data: 'third' });
      
      expect(actionSync.getStatus().queueLength).toBe(3);
      expect(actionSync.isSynced()).toBe(false);

      // Mock successful server response
      global.fetch.mockResolvedValue(createMockResponse({
        success: true,
        lastActionId: 'server-last-id-123',
        actions: [] // No remote actions
      }));

      // First sync - should send all 3 actions
      await actionSync.sync();

      // Verify fetch was called with all actions
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const firstSyncCall = global.fetch.mock.calls[0];
      const firstSyncPayload = JSON.parse(firstSyncCall[1].body);
      
      expect(firstSyncPayload.actions).toHaveLength(3);
      expect(firstSyncPayload.actions[0].payload.type).toBe('ACTION_1');
      expect(firstSyncPayload.actions[1].payload.type).toBe('ACTION_2');
      expect(firstSyncPayload.actions[2].payload.type).toBe('ACTION_3');

      // After sync, queue should be cleared and marked as synced
      expect(actionSync.getStatus().queueLength).toBe(0);
      expect(actionSync.isSynced()).toBe(true);

      // Mock another successful response for second sync
      global.fetch.mockResolvedValue(createMockResponse({
        success: true,
        lastActionId: 'server-last-id-456',
        actions: []
      }));

      // Second sync - should NOT resend the previous actions
      await actionSync.sync();

      // Verify second fetch was called with empty actions array
      expect(global.fetch).toHaveBeenCalledTimes(2);
      const secondSyncCall = global.fetch.mock.calls[1];
      const secondSyncPayload = JSON.parse(secondSyncCall[1].body);
      
      expect(secondSyncPayload.actions).toHaveLength(0); // No actions to resend
      expect(actionSync.isSynced()).toBe(true);
    });

    test('should only send new actions after partial sync failure', async () => {
      // Dispatch initial actions
      actionSync.dispatch({ type: 'ACTION_1', data: 'first' });
      actionSync.dispatch({ type: 'ACTION_2', data: 'second' });

      // Mock server error for first sync
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      // First sync should fail
      await expect(actionSync.sync()).rejects.toThrow('Network error');
      
      // Actions should still be in queue after failed sync
      expect(actionSync.getStatus().queueLength).toBe(2);
      expect(actionSync.isSynced()).toBe(false);

      // Add a new action after failed sync
      actionSync.dispatch({ type: 'ACTION_3', data: 'third' });
      expect(actionSync.getStatus().queueLength).toBe(3);

      // Mock successful response for retry
      global.fetch.mockResolvedValueOnce(createMockResponse({
        success: true,
        lastActionId: 'server-last-id-789',
        actions: []
      }));

      // Retry sync - should send all 3 actions (2 failed + 1 new)
      await actionSync.sync();

      expect(global.fetch).toHaveBeenCalledTimes(2); // 1 failed + 1 successful
      const retrySyncCall = global.fetch.mock.calls[1];
      const retrySyncPayload = JSON.parse(retrySyncCall[1].body);
      
      expect(retrySyncPayload.actions).toHaveLength(3);
      expect(actionSync.getStatus().queueLength).toBe(0);
      expect(actionSync.isSynced()).toBe(true);
    });

    test('should handle mixed local and remote actions correctly', async () => {
      // Dispatch local actions
      actionSync.dispatch({ type: 'LOCAL_1', data: 'local' });
      actionSync.dispatch({ type: 'LOCAL_2', data: 'local' });

      // Mock server response with remote actions
      const remoteActions = [
        {
          actionId: 'remote-1',
          timestamp: Date.now() - 1000,
          deviceId: 'other-device',
          payload: { type: 'REMOTE_1', data: 'remote' }
        },
        {
          actionId: 'remote-2', 
          timestamp: Date.now() - 500,
          deviceId: 'other-device',
          payload: { type: 'REMOTE_2', data: 'remote' }
        }
      ];

      global.fetch.mockResolvedValue(createMockResponse({
        success: true,
        lastActionId: 'server-last-id-mixed',
        actions: remoteActions
      }));

      // Sync should send local actions and receive remote payloads
      const result = await actionSync.sync();

      // Verify local actions were sent
      const syncCall = global.fetch.mock.calls[0];
      const syncPayload = JSON.parse(syncCall[1].body);
      expect(syncPayload.actions).toHaveLength(2);
      expect(syncPayload.actions[0].payload.type).toBe('LOCAL_1');
      expect(syncPayload.actions[1].payload.type).toBe('LOCAL_2');

      // Verify remote payloads were returned (not added to queue)
      expect(result.remotePayloads).toHaveLength(2);
      expect(result.remotePayloads[0].type).toBe('REMOTE_1');
      expect(result.remotePayloads[1].type).toBe('REMOTE_2');

      // Verify local queue is cleared but remote actions are not added
      expect(actionSync.getStatus().queueLength).toBe(0);
      expect(actionSync.isSynced()).toBe(true);

      // Next sync should send no actions
      global.fetch.mockResolvedValue(createMockResponse({
        success: true,
        lastActionId: 'server-last-id-empty',
        actions: []
      }));

      await actionSync.sync();
      
      const nextSyncCall = global.fetch.mock.calls[1];
      const nextSyncPayload = JSON.parse(nextSyncCall[1].body);
      expect(nextSyncPayload.actions).toHaveLength(0);
    });
  });

  describe('Export/Import with Queue Management', () => {
    test('should export all actions without clearing queue', () => {
      // Add some actions
      actionSync.dispatch({ type: 'EXPORT_1' });
      actionSync.dispatch({ type: 'EXPORT_2' });
      
      expect(actionSync.getStatus().queueLength).toBe(2);
      expect(actionSync.isSynced()).toBe(false);

      // Export should include all actions but not clear the queue
      const exportData = actionSync.export();
      const exportParsed = JSON.parse(exportData);
      
      expect(actionSync.getStatus().queueLength).toBe(2); // Queue should remain
      expect(actionSync.isSynced()).toBe(false); // Still not synced
      expect(exportParsed.actions).toHaveLength(2);
      expect(exportParsed.actions[0].payload.type).toBe('EXPORT_1');
      expect(exportParsed.actions[1].payload.type).toBe('EXPORT_2');
    });

    test('should handle multi-device scenario with fullQueue', async () => {
      // Simulate the scenario described in the user request
      
      // Device dispatches actions
      actionSync.dispatch({ type: 'ACTION_1' });
      actionSync.dispatch({ type: 'ACTION_2' });
      
      expect(actionSync.getStatus().queueLength).toBe(2);
      expect(actionSync.getStatus().fullQueueLength).toBe(0);
      
      // Device syncs successfully - actions move to fullQueue
      global.fetch.mockResolvedValue(createMockResponse({
        success: true,
        lastActionId: 'server-123',
        actions: []
      }));
      
      await actionSync.sync();
      
      expect(actionSync.getStatus().queueLength).toBe(0); // Synced actions cleared
      expect(actionSync.getStatus().fullQueueLength).toBe(2); // Moved to fullQueue
      expect(actionSync.getStatus().totalActionsCount).toBe(2);
      
      // User adds more actions after sync
      actionSync.dispatch({ type: 'ACTION_3' });
      
      expect(actionSync.getStatus().queueLength).toBe(1);
      expect(actionSync.getStatus().fullQueueLength).toBe(2);
      expect(actionSync.getStatus().totalActionsCount).toBe(3);
      
      // Export should include ALL actions (fullQueue + actionQueue)
      const exportData = actionSync.export();
      const exportParsed = JSON.parse(exportData);
      
      expect(exportParsed.actions).toHaveLength(3);
      expect(exportParsed.actions[0].payload.type).toBe('ACTION_1');
      expect(exportParsed.actions[1].payload.type).toBe('ACTION_2');
      expect(exportParsed.actions[2].payload.type).toBe('ACTION_3');
      
      // New device importing should get all actions
      const newDevice = new ActionSync({
        deviceId: 'new-device',
        autoSync: false,
        retryAttempts: 1
      });
      
      try {
        const importedPayloads = newDevice.import(exportData);
        expect(importedPayloads).toHaveLength(3);
        expect(importedPayloads[0].type).toBe('ACTION_1');
        expect(importedPayloads[1].type).toBe('ACTION_2');
        expect(importedPayloads[2].type).toBe('ACTION_3');
      } finally {
        newDevice.destroy();
      }
    });



    test('should return payloads from import', () => {
      // Create export data
      const exportData = {
        deviceId: 'other-device',
        timestamp: Date.now(),
        lastActionId: 'import-test-123',
        actions: [
          {
            actionId: 'import-1',
            timestamp: Date.now() - 1000,
            deviceId: 'other-device',
            payload: { type: 'IMPORTED_1', data: 'test1' }
          },
          {
            actionId: 'import-2',
            timestamp: Date.now() - 500,
            deviceId: 'other-device',
            payload: { type: 'IMPORTED_2', data: 'test2' }
          }
        ]
      };

      const payloads = actionSync.import(JSON.stringify(exportData));
      
      expect(Array.isArray(payloads)).toBe(true);
      expect(payloads).toHaveLength(2);
      expect(payloads[0].type).toBe('IMPORTED_1');
      expect(payloads[1].type).toBe('IMPORTED_2');
      
      // Import should not affect local queue
      expect(actionSync.getStatus().queueLength).toBe(0);
      expect(actionSync.isSynced()).toBe(true);
    });
  });

  describe('Action Filtering and Deduplication', () => {
    test('should remove duplicate actions when using filterKeys', () => {
      // Dispatch initial actions
      actionSync.dispatch({ type: 'SAVE_NOTE', id: 'note1', content: 'first version' });
      actionSync.dispatch({ type: 'SAVE_NOTE', id: 'note2', content: 'another note' });
      actionSync.dispatch({ type: 'OTHER_ACTION', data: 'unrelated' });
      
      expect(actionSync.getStatus().queueLength).toBe(3);
      
      // Dispatch with filter keys - should remove the first SAVE_NOTE with id='note1'
      actionSync.dispatch(
        { type: 'SAVE_NOTE', id: 'note1', content: 'updated version' },
        ['type', 'id']
      );
      
      expect(actionSync.getStatus().queueLength).toBe(3); // Still 3 total (one removed, one added)
      
      // Verify the remaining actions
      const actions = actionSync.actionQueue;
      const saveNote1Actions = actions.filter(a => a.payload.type === 'SAVE_NOTE' && a.payload.id === 'note1');
      const saveNote2Actions = actions.filter(a => a.payload.type === 'SAVE_NOTE' && a.payload.id === 'note2');
      const otherActions = actions.filter(a => a.payload.type === 'OTHER_ACTION');
      
      expect(saveNote1Actions).toHaveLength(1);
      expect(saveNote1Actions[0].payload.content).toBe('updated version');
      expect(saveNote2Actions).toHaveLength(1);
      expect(otherActions).toHaveLength(1);
    });

    test('should not remove actions if filter keys do not match', () => {
      // Dispatch initial actions
      actionSync.dispatch({ type: 'SAVE_NOTE', id: 'note1', content: 'first version' });
      actionSync.dispatch({ type: 'SAVE_NOTE', id: 'note2', content: 'another note' });
      
      expect(actionSync.getStatus().queueLength).toBe(2);
      
      // Dispatch with different id - should not remove any existing actions
      actionSync.dispatch(
        { type: 'SAVE_NOTE', id: 'note3', content: 'new note' },
        ['type', 'id']
      );
      
      expect(actionSync.getStatus().queueLength).toBe(3); // All 3 should remain
      
      const noteActions = actionSync.actionQueue.filter(a => a.payload.type === 'SAVE_NOTE');
      expect(noteActions).toHaveLength(3);
    });

    test('should work with single filter key', () => {
      // Dispatch actions with same type
      actionSync.dispatch({ type: 'USER_PREF', setting: 'theme', value: 'dark' });
      actionSync.dispatch({ type: 'USER_PREF', setting: 'lang', value: 'en' });
      actionSync.dispatch({ type: 'OTHER_ACTION', data: 'test' });
      
      expect(actionSync.getStatus().queueLength).toBe(3);
      
      // Dispatch with type filter - should remove all USER_PREF actions
      actionSync.dispatch(
        { type: 'USER_PREF', setting: 'theme', value: 'light' },
        ['type']
      );
      
      expect(actionSync.getStatus().queueLength).toBe(2); // 2 removed, 1 added = 2 total
      
      const userPrefActions = actionSync.actionQueue.filter(a => a.payload.type === 'USER_PREF');
      const otherActions = actionSync.actionQueue.filter(a => a.payload.type === 'OTHER_ACTION');
      
      expect(userPrefActions).toHaveLength(1);
      expect(userPrefActions[0].payload.value).toBe('light');
      expect(otherActions).toHaveLength(1);
    });

    test('should not filter if new action does not contain all filter keys', () => {
      // Dispatch initial action
      actionSync.dispatch({ type: 'SAVE_NOTE', id: 'note1', content: 'first version' });
      
      expect(actionSync.getStatus().queueLength).toBe(1);
      
      // Dispatch action without 'id' key - should not filter
      actionSync.dispatch(
        { type: 'SAVE_NOTE', content: 'no id action' },
        ['type', 'id']
      );
      
      expect(actionSync.getStatus().queueLength).toBe(2); // Both should remain
    });

    test('should handle empty filterKeys gracefully', () => {
      actionSync.dispatch({ type: 'TEST_ACTION', data: 'test1' });
      actionSync.dispatch({ type: 'TEST_ACTION', data: 'test2' });
      
      expect(actionSync.getStatus().queueLength).toBe(2);
      
      // Dispatch with empty filterKeys - should not remove anything
      actionSync.dispatch({ type: 'TEST_ACTION', data: 'test3' }, []);
      
      expect(actionSync.getStatus().queueLength).toBe(3);
    });

    test('should validate filterKeys parameter', () => {
      expect(() => {
        actionSync.dispatch({ type: 'TEST' }, 'not-an-array');
      }).toThrow('filterKeys must be an array');
      
      expect(() => {
        actionSync.dispatch({ type: 'TEST' }, null);
      }).toThrow('filterKeys must be an array');
    });

    test('should work with complex filter keys', () => {
      // Dispatch actions with nested properties
      actionSync.dispatch({ 
        type: 'UPDATE_ENTITY', 
        entity: 'user', 
        id: '123', 
        data: { name: 'John', age: 30 } 
      });
      
      actionSync.dispatch({ 
        type: 'UPDATE_ENTITY', 
        entity: 'user', 
        id: '456', 
        data: { name: 'Jane', age: 25 } 
      });
      
      actionSync.dispatch({ 
        type: 'UPDATE_ENTITY', 
        entity: 'post', 
        id: '123', 
        data: { title: 'Post title' } 
      });
      
      expect(actionSync.getStatus().queueLength).toBe(3);
      
      // Update user 123 - should remove first action but keep others
      actionSync.dispatch(
        { 
          type: 'UPDATE_ENTITY', 
          entity: 'user', 
          id: '123', 
          data: { name: 'John Updated', age: 31 } 
        },
        ['type', 'entity', 'id']
      );
      
      expect(actionSync.getStatus().queueLength).toBe(3); // 1 removed, 1 added
      
      const actions = actionSync.actionQueue;
      const user123Actions = actions.filter(a => 
        a.payload.type === 'UPDATE_ENTITY' && 
        a.payload.entity === 'user' && 
        a.payload.id === '123'
      );
      
      expect(user123Actions).toHaveLength(1);
      expect(user123Actions[0].payload.data.name).toBe('John Updated');
    });
  });

  describe('Error Handling', () => {
    test('should handle sync errors gracefully', async () => {
      actionSync.dispatch({ type: 'ERROR_TEST' });
      
      global.fetch.mockRejectedValueOnce(new Error('Server unavailable'));
      
      await expect(actionSync.sync()).rejects.toThrow('Server unavailable');
      
      // Actions should remain in queue after error
      expect(actionSync.getStatus().queueLength).toBe(1);
      expect(actionSync.isSynced()).toBe(false);
    });

    test('should handle invalid import data', () => {
      expect(() => actionSync.import('invalid json')).toThrow('Import failed');
      expect(() => actionSync.import('{}')).toThrow('Invalid import data');
    });
  });

  describe('Auto-sync with Callback', () => {
    test('should call onRemoteActions callback during sync', async () => {
      const mockCallback = jest.fn();
      
      const autoSyncInstance = new ActionSync({
        serverUrl: mockServerUrl,
        deviceId: 'auto-sync-device',
        autoSync: false, // We'll trigger manually
        onRemoteActions: mockCallback,
        retryAttempts: 1 // Reduce retries for faster tests
      });

      try {
        // Wait for initialization to complete
        await delay(10);

        // Mock server response with remote actions
        const remoteActions = [
          {
            actionId: 'callback-1',
            timestamp: Date.now(),
            deviceId: 'other-device',
            payload: { type: 'CALLBACK_TEST', data: 'callback' }
          }
        ];

        global.fetch.mockResolvedValue(createMockResponse({
          success: true,
          lastActionId: 'callback-test-id',
          actions: remoteActions
        }));

        // Trigger sync manually
        await autoSyncInstance.sync();

        // Verify callback was called with payloads
        expect(mockCallback).toHaveBeenCalledTimes(1);
        expect(mockCallback).toHaveBeenCalledWith([
          { type: 'CALLBACK_TEST', data: 'callback' }
        ]);
      } finally {
        autoSyncInstance.destroy();
      }
    });
  });

  describe('Chrome Storage Persistence', () => {
    test('should save queue to storage when actions are dispatched', async () => {
      // Wait for initialization to complete
      await delay(10);

      actionSync.dispatch({ type: 'STORAGE_TEST_1' });
      actionSync.dispatch({ type: 'STORAGE_TEST_2' });

      // Wait for async save operation
      await delay(10);

      // Verify storage was called
      expect(chrome.storage.local.set).toHaveBeenCalled();
      
      // Get the stored data
      const setCall = chrome.storage.local.set.mock.calls[chrome.storage.local.set.mock.calls.length - 1];
      const storedData = setCall[0][`actionsync_${mockDeviceId}`];
      
      expect(storedData.actionQueue).toHaveLength(2);
      expect(storedData.actionQueue[0].payload.type).toBe('STORAGE_TEST_1');
      expect(storedData.actionQueue[1].payload.type).toBe('STORAGE_TEST_2');
    });

    test('should load queue from storage on initialization', async () => {
      // Pre-populate storage with test data
      const testData = {
        actionQueue: [
          {
            actionId: 'stored-1',
            timestamp: Date.now() - 1000,
            deviceId: mockDeviceId,
            payload: { type: 'STORED_ACTION_1' }
          }
        ],
        lastActionId: 'stored-last-id',
        actionIdCounter: 5
      };

      chrome.storage.local.get.mockImplementation((keys, callback) => {
        if (keys.includes(`actionsync_${mockDeviceId}`)) {
          callback({ [`actionsync_${mockDeviceId}`]: testData });
        } else if (keys.includes(`actionsync_full_${mockDeviceId}`)) {
          callback({ [`actionsync_full_${mockDeviceId}`]: null });
        } else {
          callback({});
        }
      });

      // Create new instance to test loading
      const newActionSync = new ActionSync({
        serverUrl: mockServerUrl,
        deviceId: mockDeviceId,
        autoSync: false,
        retryAttempts: 1
      });

      try {
        // Wait for initialization to complete
        await delay(50);

        // Verify data was loaded
        expect(newActionSync.getStatus().queueLength).toBe(1);
        expect(newActionSync.lastActionId).toBe('stored-last-id');
      } finally {
        newActionSync.destroy();
      }
    });

    test('should save to storage after sync clears queue', async () => {
      // Wait for initialization
      await delay(10);

      actionSync.dispatch({ type: 'SYNC_CLEAR_TEST' });
      
      // Wait for dispatch save
      await delay(10);
      
      const setCallsBefore = chrome.storage.local.set.mock.calls.length;

      // Mock successful sync
      global.fetch.mockResolvedValue(createMockResponse({
        success: true,
        lastActionId: 'sync-clear-id',
        actions: []
      }));

      await actionSync.sync();
      
      // Wait for sync save
      await delay(10);

      // Verify additional storage saves were called after sync (both regular and fullQueue)
      expect(chrome.storage.local.set.mock.calls.length).toBeGreaterThan(setCallsBefore);
      
      // Find the call that saved regular actionQueue data (not fullQueue)
      let actionQueueStorageCall = null;
      for (let i = setCallsBefore; i < chrome.storage.local.set.mock.calls.length; i++) {
        const call = chrome.storage.local.set.mock.calls[i];
        const data = call[0][`actionsync_${mockDeviceId}`];
        if (data && data.hasOwnProperty('actionQueue')) {
          actionQueueStorageCall = data;
          break;
        }
      }
      
      expect(actionQueueStorageCall).not.toBeNull();
      expect(actionQueueStorageCall.actionQueue).toHaveLength(0); // Queue should be empty after sync
    });

    test('should clear storage on destroy', async () => {
      // Wait for initialization
      await delay(10);

      actionSync.destroy();
      
      // Wait for async clear operation
      await delay(10);

      // Verify storage remove was called with both storage keys
      expect(chrome.storage.local.remove).toHaveBeenCalledWith([`actionsync_${mockDeviceId}`, `actionsync_full_${mockDeviceId}`], expect.any(Function));
    });

    test('should handle storage errors gracefully', async () => {
      // Mock storage error
      chrome.runtime.lastError = new Error('Storage quota exceeded');
      chrome.storage.local.set.mockImplementation((data, callback) => {
        callback();
      });

      // Should not throw error when storage fails
      expect(() => {
        actionSync.dispatch({ type: 'ERROR_TEST' });
      }).not.toThrow();

      // Reset error
      chrome.runtime.lastError = null;
    });

    test('should work without Chrome storage available', async () => {
      // Create instance with persistence disabled
      const noPersistenceSync = new ActionSync({
        serverUrl: mockServerUrl,
        deviceId: 'no-persist-device',
        autoSync: false,
        enablePersistence: false,
        retryAttempts: 1
      });

      try {
        // Wait for initialization
        await delay(10);

        // Should work normally without storage
        noPersistenceSync.dispatch({ type: 'NO_PERSIST_TEST' });
        expect(noPersistenceSync.getStatus().queueLength).toBe(1);
        
        // Storage should not be called when persistence is disabled
        const initialSetCalls = chrome.storage.local.set.mock.calls.length;
        noPersistenceSync.dispatch({ type: 'NO_PERSIST_TEST_2' });
        
        await delay(10);
        
        // Should not have additional storage calls
        expect(chrome.storage.local.set.mock.calls.length).toBe(initialSetCalls);
      } finally {
        noPersistenceSync.destroy();
      }
    });
  });
}); 