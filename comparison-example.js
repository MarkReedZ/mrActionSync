import ActionSync from './actionsync.js';
import ActionSyncSimple from './actionsync-simple.js';

console.log('=== ActionSync Comparison: With vs Without Device IDs ===\n');

// Initialize both versions
const actionSyncWithDeviceId = new ActionSync({
  deviceId: 'device-123',
  debug: false,
  autoSync: false
});

const actionSyncSimple = new ActionSyncSimple({
  debug: false,
  autoSync: false
});

console.log('1. Dispatching identical actions to both versions...');

// Dispatch the same actions to both
const actions = [
  { type: 'CLICK', element: 'button-1' },
  { type: 'INPUT', field: 'name', value: 'test' },
  { type: 'SUBMIT', form: 'login' }
];

actions.forEach((action, i) => {
  const id1 = actionSyncWithDeviceId.dispatch(action);
  const id2 = actionSyncSimple.dispatch(action);
  console.log(`  Action ${i + 1}: WithDeviceId=${id1.substring(0, 16)}..., Simple=${id2.substring(0, 16)}...`);
});

console.log('\n2. Comparing exported data structures...');

const export1 = JSON.parse(actionSyncWithDeviceId.export());
const export2 = JSON.parse(actionSyncSimple.export());

console.log('WithDeviceId export structure:');
console.log('  deviceId:', export1.deviceId);
console.log('  actions[0].deviceId:', export1.actions[0].deviceId);
console.log('  actions[0].actionId:', export1.actions[0].actionId);
console.log('  actions[0].payload:', export1.actions[0].payload);

console.log('\nSimple export structure:');
console.log('  deviceId:', export2.deviceId || 'NOT PRESENT');
console.log('  actions[0].deviceId:', export2.actions[0].deviceId || 'NOT PRESENT');  
console.log('  actions[0].actionId:', export2.actions[0].actionId);
console.log('  actions[0].payload:', export2.actions[0].payload);

console.log('\n3. Cross-importing (Simple -> WithDeviceId)...');
try {
  const importResult = actionSyncWithDeviceId.import(actionSyncSimple.export());
  console.log('  Import successful:', importResult.success);
  console.log('  Imported count:', importResult.importedCount);
} catch (error) {
  console.log('  Import failed:', error.message);
}

console.log('\n4. Testing functionality equivalence...');

// Test that both can import each other's data
const simpleExport = actionSyncSimple.export();
const withDeviceExport = actionSyncWithDeviceId.export();

console.log('  Simple can import WithDeviceId data:', (() => {
  try {
    actionSyncSimple.clearQueue();
    const result = actionSyncSimple.import(withDeviceExport);
    return `✓ (${result.importedCount} actions)`;
  } catch (error) {
    return `✗ (${error.message})`;
  }
})());

console.log('  WithDeviceId can import Simple data:', (() => {
  try {
    actionSyncWithDeviceId.clearQueue(); 
    const result = actionSyncWithDeviceId.import(simpleExport);
    return `✓ (${result.importedCount} actions)`;
  } catch (error) {
    return `✗ (${error.message})`;
  }
})());

console.log('\n5. Analyzing what Device IDs actually provide...');

console.log('Device IDs are useful for:');
console.log('  ✓ Debugging - knowing which device created an action');
console.log('  ✓ Server analytics - tracking device-level behavior'); 
console.log('  ✓ Audit trails - compliance and logging requirements');
console.log('  ✓ Future features - device-specific permissions/filtering');

console.log('\nDevice IDs are NOT needed for:');
console.log('  ✓ Action uniqueness - actionId handles this');
console.log('  ✓ Timestamp ordering - actionId contains timestamp');
console.log('  ✓ Preventing duplicates - actionId comparison works');
console.log('  ✓ Basic sync functionality - actions are self-contained');

console.log('\n6. Recommendation:');
console.log('For SIMPLE action replay systems: Device IDs are optional');
console.log('For PRODUCTION systems: Device IDs recommended for debugging/analytics');

console.log('\n=== Comparison Complete ==='); 