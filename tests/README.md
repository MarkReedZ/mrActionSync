# ActionSync Testing

This directory contains the testing infrastructure for ActionSync.

## Test Infrastructure

We provide two testing options:

### 1. Jest (Recommended)
Full-featured testing framework with mocking, coverage, and watch mode.

**Installation:**
```bash
npm install
```

**Running Tests:**
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

### 2. Simple Test Runner
Lightweight alternative for basic testing without external dependencies.

**Running Tests:**
```bash
npm run test:simple
```

## Key Test Cases

### No Resending Already Sent Actions
The main test validates that ActionSync doesn't resend actions that have already been successfully synchronized:

1. **Queue Management**: Actions are queued locally until sync
2. **Successful Sync**: After successful sync, queue is cleared
3. **No Resending**: Subsequent syncs don't include previously sent actions
4. **Failure Recovery**: Failed syncs keep actions in queue for retry

### Test Coverage

- ✅ Basic initialization and properties
- ✅ Action dispatching and queue management
- ✅ Sync behavior with server mocking
- ✅ No resending of already sent actions
- ✅ Export/import with queue clearing
- ✅ Error handling
- ✅ Auto-sync callback functionality

## Test Files

- `setup.js` - Jest configuration and global mocks
- `actionsync.test.js` - Comprehensive Jest test suite
- `run-tests.js` - Simple test runner (no dependencies)

## Writing New Tests

### Jest Tests
Add new tests to `actionsync.test.js`:

```javascript
test('should handle new functionality', async () => {
  // Mock server response
  global.fetch.mockResolvedValue(createMockResponse({
    success: true,
    actions: []
  }));
  
  // Test your functionality
  const result = await actionSync.someNewMethod();
  
  // Assertions
  expect(result).toBe(expectedValue);
});
```

### Simple Tests
Add new tests to `run-tests.js`:

```javascript
test('should handle new functionality', () => {
  // Setup
  const actionSync = new ActionSync({ /* config */ });
  
  // Test
  const result = actionSync.someNewMethod();
  
  // Assert
  expect(result).toBe(expectedValue);
  
  // Cleanup
  actionSync.destroy();
});
```

## Mocking Strategy

### Server Communication
Tests mock `fetch` to simulate server responses:

```javascript
global.fetch.mockResolvedValue({
  ok: true,
  status: 200,
  json: () => Promise.resolve({
    success: true,
    lastActionId: 'mock-id',
    actions: [/* remote actions */]
  })
});
```

### Browser APIs
Tests mock browser APIs like clipboard:

```javascript
navigator.clipboard.writeText.mockResolvedValue();
navigator.clipboard.readText.mockResolvedValue('mock data');
```

## Test Data

Use consistent test data patterns:

```javascript
const mockAction = { type: 'TEST_ACTION', data: 'test' };
const mockDeviceId = 'test-device-123';
const mockServerUrl = 'https://test-server.com/api';
```

## Continuous Integration

To run tests in CI environments:

```bash
# Install dependencies
npm ci

# Run tests with coverage
npm run test:coverage

# Or use simple runner (no dependencies)
npm run test:simple
``` 